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
        if (Array.isArray(data)) return data.map(item => this.mapApiItem(item))
      }
    } catch {}

    return this.searchRss({ query, fetcher })
  }

  async searchRss({ query, fetcher }) {
    const url =
      `${this.base}?page=rss&f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc`

    const res = await fetcher(url)
    if (!res.ok) return []

    return this.parseRss(await res.text())
  }

  pickTitle(titles) {
    const latin = titles.filter(title => /[a-zA-Z]/.test(title))
    const pool = latin.length ? latin : titles
    return pool.reduce((shortest, title) => title.length < shortest.length ? title : shortest)
  }

  buildQuery(title, episode, resolution, batch) {
    let query = title.replace(/[^\w\s-]/g, ' ').trim()
    if (!batch && episode != null) query += ` ${String(episode).padStart(2, '0')}`
    if (batch) query += ' Batch'
    if (resolution) query += ` ${resolution}p`
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
