export default new class Nyaa {
  base = 'https://nyaa.si'
  ns = 'https://nyaa.si/xmlns/nyaa'

  // Build search query from title + optional episode number
  buildQuery (title, episode) {
    const clean = title.replace(/[^\w\s\-]/g, ' ').trim()
    if (episode != null) return `${clean} ${String(episode).padStart(2, '0')}`
    return clean
  }

  // Fetch nyaa RSS and parse results
  async fetchRSS (query, category = '1_2') {
    const nyaaUrl = `https://nyaa.si/?page=rss&q=${encodeURIComponent(query)}&c=${category}&f=0`
    const url = `https://corsproxy.io/?url=${encodeURIComponent(nyaaUrl)}`
    const res = await fetch(url)
    if (!res.ok) return []
    const text = await res.text()
    return this.parseRSS(text)
  }

  parseRSS (xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    const items = [...doc.querySelectorAll('item')]

    return items.map(item => {
      const get = tag => item.querySelector(tag)?.textContent?.trim() ?? ''

      // getElementsByTagNameNS is the correct way to handle nyaa: prefixed tags
      const getNS = tag => (
        item.getElementsByTagNameNS(this.ns, tag)[0] ??
        item.getElementsByTagName(`nyaa:${tag}`)[0]  // fallback for some parsers
      )?.textContent?.trim() ?? ''

      const hash = getNS('infoHash')
      const title = get('title')

      if (!hash) return null

      // Build magnet with common public trackers
      const magnet = [
        `magnet:?xt=urn:btih:${hash}`,
        `dn=${encodeURIComponent(title)}`,
        'tr=http%3A%2F%2Fnyaa.tracker.wf%3A7777%2Fannounce',
        'tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce',
        'tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
      ].join('&')

      return {
        title,
        link: magnet,
        hash,
        seeders: parseInt(getNS('seeders')) || 0,
        leechers: parseInt(getNS('leechers')) || 0,
        downloads: parseInt(getNS('downloads')) || 0,
        size: this.parseSize(getNS('size')),
        date: new Date(get('pubDate')),
        verified: getNS('trusted') === 'Yes',
        type: 'alt',
        accuracy: 'high'
      }
    }).filter(Boolean)
  }

  parseSize (str) {
    const m = str?.match(/([\d.]+)\s*(KiB|MiB|GiB|TiB)/i)
    if (!m) return 0
    const val = parseFloat(m[1])
    const units = { kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }
    return Math.round(val * (units[m[2].toLowerCase()] ?? 0))
  }

  /** @type {import('./').SearchFunction} */
  async single ({ titles, episode }) {
    if (!titles?.length) return []
    return this.fetchRSS(this.buildQuery(titles[0], episode))
  }

  /** @type {import('./').SearchFunction} */
  async batch ({ titles }) {
    if (!titles?.length) return []
    // Don't include episode number for batch — grab everything and mark as batch type
    const results = await this.fetchRSS(this.buildQuery(titles[0], null))
    return results.map(r => ({ ...r, type: 'batch' }))
  }

  /** @type {import('./').SearchFunction} */
  async movie ({ titles }) {
    if (!titles?.length) return []
    return this.fetchRSS(this.buildQuery(titles[0], null))
  }

  async test () {
    try {
      const res = await fetch(`${this.base}/?page=rss&q=test&c=1_2`)
      return res.ok
    } catch {
      return false
    }
  }
}()
