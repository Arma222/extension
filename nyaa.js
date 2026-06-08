export default new class Sukebei {
  base = 'https://sukebei.nyaa.si/'

  /** @type {import('./').SearchFunction} */
  async single({ titles, episode }) {
    if (!titles?.length) return []

    const query = this.buildQuery(titles[0], episode)

    const url =
      `${this.base}?f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc`

    const res = await fetch(url)
    const html = await res.text()

    return this.parse(html)
  }

  batch = this.single
  movie = this.single

  buildQuery(title, episode) {
    let query = title.replace(/[^\w\s-]/g, ' ').trim()
    if (episode) query += ` ${episode.toString().padStart(2, '0')}`
    return query
  }

  parse(html) {
    const results = []

    const rows = html.match(/<tr class="(?:default|success|danger)">[\s\S]*?<\/tr>/g) || []

    for (const row of rows) {
      const titleMatch = row.match(/title="([^"]+)"/)
      const magnetMatch = row.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/)
      const seedersMatch = row.match(/<td class="text-center">(\d+)<\/td>\s*<td class="text-center">(\d+)<\/td>/)

      if (!titleMatch || !magnetMatch) continue

      const hash =
        magnetMatch[1].match(/btih:([A-Fa-f0-9]+)/)?.[1] || ''

      results.push({
        title: titleMatch[1],
        link: magnetMatch[1],
        hash,
        seeders: seedersMatch ? Number(seedersMatch[1]) : 0,
        leechers: seedersMatch ? Number(seedersMatch[2]) : 0,
        downloads: 0,
        size: 0,
        date: new Date(),
        verified: false,
        type: 'alt',
        accuracy: 'medium'
      })
    }

    return results
  }

  async test() {
    try {
      const res = await fetch(this.base)
      return res.ok
    } catch {
      return false
    }
  }
}()
