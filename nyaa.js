export default new class Sukebei {
  base = 'https://sukebei.nyaa.si/'

  trackers = [
    'http://sukebei.tracker.wf:8888/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://tracker.torrent.eu.org:451/announce'
  ]

  /** @type {import('./').SearchFunction} */
  async single({ titles, episode }) {
    if (!titles?.length) return []

    const query = this.buildQuery(titles[0], episode)
    const url =
      `${this.base}?page=rss&f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc`

    const res = await fetch(url)
    const xml = await res.text()

    return this.parse(xml)
  }

  /** @type {import('./').SearchFunction} */
  batch = this.single
  movie = this.single

  buildQuery(title, episode) {
    let query = title.replace(/[^\w\s-]/g, ' ').trim()
    if (episode) query += ` ${episode.toString().padStart(2, '0')}`
    return query
  }

  parse(xml) {
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || []

    return items.map(item => {
      const title = this.decode(this.tag(item, 'title'))
      const hash = this.tag(item, 'nyaa:infoHash')

      return {
        title,
        link: this.magnet(hash, title),
        hash,
        seeders: this.number(this.tag(item, 'nyaa:seeders')),
        leechers: this.number(this.tag(item, 'nyaa:leechers')),
        downloads: this.number(this.tag(item, 'nyaa:downloads')),
        size: this.parseSize(this.tag(item, 'nyaa:size')),
        date: new Date(this.tag(item, 'pubDate')),
        verified: this.tag(item, 'nyaa:trusted') === 'Yes',
        type: 'alt',
        accuracy: 'medium'
      }
    }).filter(item => item.title && item.hash)
  }

  tag(xml, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`))
    return match?.[1]?.trim() || ''
  }

  magnet(hash, title) {
    const params = [
      `xt=urn:btih:${hash}`,
      `dn=${encodeURIComponent(title)}`,
      ...this.trackers.map(tracker => `tr=${encodeURIComponent(tracker)}`)
    ]

    return `magnet:?${params.join('&')}`
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

  async test() {
    try {
      const res = await fetch(`${this.base}?page=rss&q=one%20piece`)
      return res.ok
    } catch {
      return false
    }
  }
}()
