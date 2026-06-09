export default new class Sukebei {
  api = 'https://nyaasi-api.vercel.app/api/search'
  base = 'https://sukebei.nyaa.si/'

  async single(query) {
    const { titles, episode, absoluteEpisodeNumber, exclusions = [], resolution } = query
    if (!titles?.length) return []

    return this.search({
      titles,
      episode,
      absoluteEpisode: absoluteEpisodeNumber,
      exclusions,
      resolution,
      batch: false,
      fetcher: this.fetcher(query)
    })
  }

  async batch(query) {
    const { titles, exclusions = [] } = query
    if (!titles?.length) return []

    return this.search({
      titles,
      exclusions,
      batch: true,
      fetcher: this.fetcher(query)
    })
  }

  async movie(query) {
    const { titles, exclusions = [], resolution } = query
    if (!titles?.length) return []

    return this.search({
      titles,
      exclusions,
      resolution,
      batch: false,
      fetcher: this.fetcher(query)
    })
  }

  async search({ titles, episode, absoluteEpisode, exclusions = [], resolution, batch, fetcher }) {
    const title = this.pickTitle(titles)
    const query = this.buildQuery(title, episode, resolution, batch)
    const params = new URLSearchParams({
      q: query,
      title,
      site: 'sukebei',
      category: '0_0',
      batch: String(batch)
    })

    if (episode != null) params.set('episode', String(episode))
    if (absoluteEpisode != null) params.set('absoluteEpisode', String(absoluteEpisode))
    if (resolution) params.set('resolution', resolution)
    if (exclusions.length) params.set('exclusions', exclusions.join(','))

    const extraTitles = titles.filter(item => item !== title).slice(0, 2)
    if (extraTitles.length) params.set('titles', extraTitles.join('|||'))

    try {
      const res = await fetcher(`${this.api}?${params}`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          return this.filterResults(data.map(item => this.mapApiItem(item)), {
            titles,
            episode,
            exclusions,
            resolution,
            batch
          })
        }
      }
    } catch {}

    return this.searchRss({ query, titles, episode, exclusions, resolution, batch, fetcher })
  }

  async searchRss({ query, titles, episode, exclusions, resolution, batch, fetcher }) {
    const url =
      `${this.base}?page=rss&f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc`

    const res = await fetcher(url)
    if (!res.ok) return []

    return this.filterResults(this.parseRss(await res.text()), {
      titles,
      episode,
      exclusions,
      resolution,
      batch
    })
  }

  pickTitle(titles) {
    const latin = titles.filter(title => /[a-zA-Z]/.test(title))
    const pool = latin.length ? latin : titles
    return pool.reduce((shortest, title) => title.length < shortest.length ? title : shortest)
  }

  buildQuery(title, episode, resolution, batch) {
    let query = title.replace(/[^\w\s-]/g, ' ').trim()
    // don't append episode or resolution to the search query
    // sukebei returns fewer results with those appended, and our filter handles ranking
    return query
  }

  mapApiItem(item) {
    return {
      title: item.title || 'Unknown',
      link: item.magnet || item.link || '',
      hash: item.hash || '',
      seeders: Number(item.seeders) || 0,
      leechers: Number(item.leechers) || 0,
      downloads: Number(item.downloads) || 0,
      size: Number(item.size) || 0,
      date: item.date ? new Date(item.date) : new Date(0),
      verified: Boolean(item.trusted),
      type: 'alt',
      accuracy: item.accuracy || 'low'
    }
  }

  filterResults(results, context) {
    const filtered = results
      .filter(item => this.allowedByExclusions(item, context.exclusions))
      .map(item => {
        const score = this.scoreResult(item, context)
        return {
          ...item,
          accuracy: score >= 120 ? 'high' : score >= 80 ? 'medium' : 'low',
          score
        }
      })
      .filter(item => item.score >= this.minScore(context))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (b.seeders !== a.seeders) return b.seeders - a.seeders
        return b.downloads - a.downloads
      })

    return filtered
      .slice(0, context.batch ? 12 : 8)
      .map(({ score, ...item }) => item)
  }

  scoreResult(item, { titles, episode, resolution, batch }) {
    const bestMatch = titles.reduce((best, title) => {
      const result = this.scoreTitle(item.title, title)
      return result.score > best.score ? result : best
    }, { score: 0, ratio: 0 })

    let score = bestMatch.score

    // hard reject: if less than 60% of search tokens matched, this is likely wrong anime
    if (bestMatch.ratio < 0.45) return -100

    if (!batch && episode != null) {
      const epMatch = this.matchesEpisode(item.title, episode)
      score += epMatch ? 60 : -60
      if (this.looksLikeBatch(item.title)) score -= 50
      // penalize if the result has a DIFFERENT episode number prominently
      if (!epMatch && this.hasAnyEpisodeNumber(item.title)) score -= 20
    }

    if (batch) {
      if (this.looksLikeBatch(item.title)) score += 35
      // single episode results should be penalized in batch mode
      if (this.hasSingleEpisodeOnly(item.title)) score -= 25
    }

    if (resolution) {
      const norm = this.normalize(item.title)
      if (norm.includes(`${resolution}p`)) score += 15
      else if (norm.match(/\b(480|720|1080|2160)p\b/)) score -= 15 // has different resolution
      else score -= 5
    }

    // penalize extremely large result titles that probably contain extra series info
    const normResult = this.normalize(item.title)
    const bestSearch = this.normalize(titles[0])
    const resultWords = normResult.split(' ').filter(w => w.length > 1).length
    const searchWords = bestSearch.split(' ').filter(w => w.length > 1).length
    if (resultWords > searchWords * 4) score -= 20

    score += Math.min(Number(item.seeders) || 0, 15)
    if (item.verified) score += 10

    return score
  }

  scoreTitle(resultTitle, searchTitle) {
    const result = this.normalize(resultTitle)
    const search = this.normalize(searchTitle)
    if (!result || !search) return { score: 0, ratio: 0 }

    const tokens = this.titleTokens(search)
    if (!tokens.length) return { score: 0, ratio: 0 }

    let score = 0

    // exact substring match is very strong signal
    if (result.includes(search)) score += 80

    // word-boundary-aware token matching to avoid partial matches
    // e.g. "one" should not match "stone" or "alone"
    const matched = tokens.filter(token => this.tokenInTitle(token, result)).length
    const ratio = matched / tokens.length
    score += Math.round(ratio * 60)

    // bonus for consecutive token runs (indicates phrase match, not scattered words)
    const consecutiveBonus = this.consecutiveTokenBonus(tokens, result)
    score += consecutiveBonus

    // penalty for very short search titles (high false-positive risk)
    if (search.length <= 4) score -= 20

    return { score, ratio }
  }

  /**
   * Check if a token appears in the title respecting word boundaries.
   * For short tokens (<=3 chars), require word boundary match to avoid false positives.
   * For longer tokens, simple includes is fine since they're unlikely to be substrings.
   */
  tokenInTitle(token, normalizedTitle) {
    if (token.length <= 3) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalizedTitle)
    }
    return normalizedTitle.includes(token)
  }

  /**
   * Bonus points for consecutive search tokens appearing in order in the result.
   * This helps distinguish "My Hero Academia" from "My Academia Hero Something".
   */
  consecutiveTokenBonus(tokens, normalizedTitle) {
    if (tokens.length < 2) return 0

    let maxRun = 0
    let currentRun = 0

    for (let i = 0; i < tokens.length; i++) {
      if (this.tokenInTitle(tokens[i], normalizedTitle)) {
        currentRun++
        if (i > 0 && currentRun > 1) {
          // verify they appear in order
          const prevIdx = normalizedTitle.indexOf(tokens[i - 1])
          const currIdx = normalizedTitle.indexOf(tokens[i], prevIdx)
          if (currIdx > prevIdx) {
            maxRun = Math.max(maxRun, currentRun)
          } else {
            currentRun = 1
          }
        } else {
          maxRun = Math.max(maxRun, currentRun)
        }
      } else {
        currentRun = 0
      }
    }

    // only give bonus for runs of 2+ consecutive tokens
    return maxRun >= 2 ? Math.min(maxRun * 8, 25) : 0
  }

  titleTokens(title) {
    return title
      .split(' ')
      .filter(token => token.length > 1)
      .filter(token => !['the', 'and', 'or', 'of', 'in', 'to', 'a', 'an', 'no',
        'wa', 'ga', 'wo', 'ni', 'de', 'season', 'part', 'vol'].includes(token))
  }

  minScore({ episode, batch }) {
    if (!batch && episode != null) return 85
    if (batch) return 70
    return 65
  }

  allowedByExclusions(item, exclusions = []) {
    const title = this.normalize(item.title)
    return !exclusions.some(exclusion => {
      const norm = this.normalize(exclusion)
      if (!norm) return false
      // use word boundary matching for short exclusions too
      if (norm.length <= 3) {
        const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(title)
      }
      return title.includes(norm)
    })
  }

  matchesEpisode(title, episode) {
    const norm = this.normalize(title)
    const value = String(episode)
    const padded = value.padStart(2, '0')
    const variants = [...new Set([value, padded])]
    const escaped = variants
      .map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')

    // match episode patterns but NOT inside resolution (e.g. 1080p), version (v2),
    // or year patterns (2024), or size numbers
    // look for: E01, EP01, Episode 01, #01, - 01, or standalone 01
    // but not: 1080p, x264, 10bit, 2024, S01
    const epPattern = new RegExp(
      `(?:^|[^0-9a-z])(?:e|ep|episode|#|\\s-\\s)\\s*(?:${escaped})(?:v\\d+)?(?:[^0-9a-z]|$)`, 'i'
    )

    if (epPattern.test(norm)) return true

    // fallback: standalone number match, but with stricter boundaries
    // the number must not be adjacent to other digits, not part of resolution/codec
    const standalonePattern = new RegExp(
      `(?:^|[^0-9a-z])(?:${escaped})(?:v\\d+)?(?:[^0-9a-z]|$)`, 'i'
    )

    if (standalonePattern.test(norm)) {
      // make sure it's not matching a resolution, codec, year, or size
      const falsePositives = /(?:480|720|1080|2160)p|x26[45]|h\.?26[45]|10bit|8bit|(?:19|20)\d{2}/i
      // check the specific match isn't part of a known false pattern
      const numStr = padded
      const idx = norm.indexOf(numStr)
      if (idx >= 0) {
        const surrounding = norm.substring(Math.max(0, idx - 5), idx + numStr.length + 5)
        if (falsePositives.test(surrounding)) return false
      }
      return true
    }

    return false
  }

  /**
   * Detect if the title contains ANY episode number pattern
   * (used to detect wrong-episode results)
   */
  hasAnyEpisodeNumber(title) {
    return /(?:^|[^a-z0-9])(?:e|ep|episode|#)\s*\d+/i.test(title) ||
           /\s-\s\d{1,3}(?:\s|$|v\d)/i.test(title)
  }

  /**
   * Detect titles that look like a single episode (not a batch)
   */
  hasSingleEpisodeOnly(title) {
    const norm = this.normalize(title)
    // has a single episode marker and no range
    return /(?:e|ep|episode)\s*\d+/i.test(norm) &&
           !/\d+\s*[-~]\s*\d+/.test(norm) &&
           !this.looksLikeBatch(title)
  }

  looksLikeBatch(title) {
    return /\b(batch|complete|collection|season|full|s\d{1,2}(?:$|[^a-z0-9])|(?:\d{1,3})\s*[-~]\s*(?:\d{1,3}))\b/i.test(title)
  }

  parseRss(xml) {
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || []

    return items.map(item => {
      const title = this.decode(this.tag(item, 'title'))
      const hash = this.tag(item, 'nyaa:infoHash')
      const link = this.decode(this.tag(item, 'link'))

      return {
        title,
        link: link.startsWith('magnet:') ? link : this.magnet(hash, title),
        hash,
        seeders: this.number(this.tag(item, 'nyaa:seeders')),
        leechers: this.number(this.tag(item, 'nyaa:leechers')),
        downloads: this.number(this.tag(item, 'nyaa:downloads')),
        size: this.parseSize(this.tag(item, 'nyaa:size')),
        date: new Date(this.tag(item, 'pubDate')),
        verified: this.tag(item, 'nyaa:trusted') === 'Yes',
        type: 'alt',
        accuracy: 'low'
      }
    }).filter(item => item.title && item.hash)
  }

  tag(xml, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'))
    return match?.[1]?.trim() || ''
  }

  magnet(hash, title) {
    return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
  }

  number(value) {
    return parseInt(value || '0', 10)
  }

  normalize(value) {
    return this.decode(String(value || ''))
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  }

  decode(value) {
    return value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
  }

  parseSize(sizeStr) {
    const match = sizeStr.match(/([\d.]+)\s*(Bytes|KiB|MiB|GiB|TiB|KB|MB|GB|TB)/i)
    if (!match) return 0

    const value = parseFloat(match[1])
    const unit = match[2].toUpperCase()

    switch (unit) {
      case 'BYTES': return value
      case 'KIB':
      case 'KB': return value * 1024
      case 'MIB':
      case 'MB': return value * 1024 * 1024
      case 'GIB':
      case 'GB': return value * 1024 * 1024 * 1024
      case 'TIB':
      case 'TB': return value * 1024 * 1024 * 1024 * 1024
      default: return 0
    }
  }

  fetcher(query) {
    return query.fetch || globalThis.fetch.bind(globalThis)
  }

  async test(_, fetch) {
    try {
      const fetcher = fetch || globalThis.fetch.bind(globalThis)
      const res = await fetcher(`${this.api}?q=test&site=sukebei&category=0_0&batch=false`)
      return res.ok
    } catch {
      return false
    }
  }
}()
