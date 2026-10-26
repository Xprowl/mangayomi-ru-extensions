// prettier-ignore
const mangayomiSources = [{
    "name": "MangaLib",
    "lang": "ru",
    "baseUrl": "https://mangalib.me",
    "apiUrl": "https://api.cdnlibs.org/api",
    "iconUrl": "https://mangalib.me/favicon.ico",
    "typeSource": "single",
    "itemType": 0,
    "version": "0.1.1",
    "isNsfw": false,
    "pkgPath": "manga/src/ru/mangalib.js"
}];

class DefaultExtension extends MProvider {
    getApiUrl() {
        return "https://api.cdnlibs.org/api";
    }

    getHeaders() {
        return {
            "Referer": "https://mangalib.me/",
            "Origin": "https://mangalib.me",
            "Site-Id": "1",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };
    }

    async requestApi(path, params = {}) {
        if (!this.client) {
            this.client = new Client();
        }
        let url = `${this.getApiUrl()}${path}`;
        const query = Object.keys(params)
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
            .join("&");
        if (query) url += `?${query}`;

        const res = await this.client.get(url, this.getHeaders());
        return JSON.parse(res.body);
    }

    parseMangaList(data) {
        const list = [];
        const items = data?.data || data?.items?.data || data || [];
        for (const item of items) {
            if (!item) continue;
            const slug = item.slug_url || item.slug || item.id;
            if (!slug) continue;

            const cover = item.cover || {};
            const imageUrl = cover.default || cover.md || cover.thumb || item.image || "";

            list.push({
                name: item.rus_name || item.name || item.eng_name || slug,
                imageUrl: imageUrl,
                link: `/ru/manga/${slug}`
            });
        }
        return list;
    }

    async getPopular(page) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            "page": page,
            "sort_by": "rating"
        });
        const list = this.parseMangaList(data);
        return {
            list: list,
            hasNextPage: list.length > 0
        };
    }

    async getLatestUpdates(page) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            "page": page,
            "sort_by": "last_chapter_at"
        });
        const list = this.parseMangaList(data);
        return {
            list: list,
            hasNextPage: list.length > 0
        };
    }

    async search(query, page, filters) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            "q": query,
            "page": page
        });
        const list = this.parseMangaList(data);
        return {
            list: list,
            hasNextPage: list.length > 0
        };
    }

    extractSlug(url) {
        const match = url.match(/(?:manga\/)?(\d+--[\w\-]+|[\w\-]+)/);
        return match ? match[1] : url.replace(/^\/+|\/+$/g, "");
    }

    async getDetail(url) {
        const slug = this.extractSlug(url);
        const data = await this.requestApi(`/manga/${slug}`);
        const manga = data?.data || data || {};

        const cover = manga.cover || {};
        const imageUrl = cover.default || cover.md || cover.thumb || "";

        let author = "";
        if (manga.authors && manga.authors.length > 0) {
            author = manga.authors.map(a => a.name).filter(Boolean).join(", ");
        }

        let status = 5;
        const st = (manga.status?.label || manga.status || "").toString().toLowerCase();
        if (st.includes("онгоинг") || st.includes("ongoing") || st.includes("продолжается")) status = 0;
        else if (st.includes("заверш") || st.includes("completed") || st.includes("закончен")) status = 1;
        else if (st.includes("заморож") || st.includes("hiatus") || st.includes("приостанов")) status = 2;
        else if (st.includes("отмен") || st.includes("canceled")) status = 3;

        const genre = [];
        if (manga.genres) {
            for (const g of manga.genres) {
                if (g.name) genre.push(g.name);
            }
        }

        const chaptersData = await this.requestApi(`/manga/${slug}/chapters`);
        const chaptersRaw = chaptersData?.data || chaptersData || [];
        const chapters = [];

        for (const ch of chaptersRaw) {
            const vol = ch.volume ?? "0";
            const num = ch.number ?? "0";
            const name = ch.name ? `Том ${vol} Глава ${num} — ${ch.name}` : `Том ${vol} Глава ${num}`;

            chapters.push({
                name: name,
                url: `${slug}|${vol}|${num}`,
                dateUpload: ch.created_at ? new Date(ch.created_at).getTime().toString() : "0"
            });
        }

        chapters.reverse();

        return {
            title: manga.rus_name || manga.name || slug,
            imageUrl: imageUrl,
            description: manga.summary || manga.description || "",
            author: author,
            status: status,
            genre: genre,
            chapters: chapters
        };
    }

    async getPageList(chapterUrl) {
        const parts = chapterUrl.split("|");
        if (parts.length < 3) return [];

        const [slug, volume, number] = parts;
        const data = await this.requestApi(`/manga/${slug}/chapter`, {
            volume: volume,
            number: number
        });

        const pagesRaw = data?.data?.pages || data?.pages || [];
        const pages = [];

        const imgDomains = [
            "https://img3.cdnlibs.org",
            "https://img4.cdnlibs.org",
            "https://img5.cdnlibs.org",
            "https://img3.mixlib.me"
        ];

        for (const page of pagesRaw) {
            let url = "";
            if (typeof page === "string") {
                url = page;
            } else {
                url = page.url || page.link || "";
            }

            if (!url) continue;

            if (url.startsWith("http")) {
                pages.push({ url: url });
            } else {
                url = url.replace(/^\//, "");
                pages.push({ url: `${imgDomains[0]}/${url}` });
            }
        }

        return pages;
    }

    getFilterList() {
        return [];
    }

    getSourcePreferences() {
        return [];
    }
}
