// prettier-ignore
const mangayomiSources = [{
    "name": "MangaLib",
    "lang": "ru",
    "baseUrl": "https://mangalib.me",
    "apiUrl": "https://api.cdnlibs.org/api",
    "iconUrl": "https://mangalib.me/favicon.ico",
    "typeSource": "single",
    "itemType": 0,
    "version": "0.1.6",
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

    getImageHeaders() {
        return {
            "Referer": "https://mangalib.me/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };
    }

    async requestApi(path, params = {}) {
        if (!this.client) {
            this.client = new Client();
        }

        let url = `${this.getApiUrl()}${path}`;
        const keys = Object.keys(params);
        if (keys.length > 0) {
            const query = keys
                .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
                .join("&");
            url += `?${query}`;
        }

        const res = await this.client.get(url, this.getHeaders());
        const text = res && res.body ? res.body : "{}";

        try {
            return JSON.parse(text);
        } catch (e) {
            return {};
        }
    }

    parseMangaList(data) {
        const list = [];
        let items = [];

        if (Array.isArray(data)) {
            items = data;
        } else if (data && Array.isArray(data.data)) {
            items = data.data;
        } else if (data && data.data && Array.isArray(data.data.data)) {
            items = data.data.data;
        } else if (data && data.data && Array.isArray(data.data.result)) {
            items = data.data.result;
        }

        for (const item of items) {
            if (!item) continue;
            const slug = item.slug_url || item.slug || item.link || String(item.id || "");
            if (!slug) continue;

            const cover = item.cover || {};
            const imageUrl = cover.default || cover.md || cover.thumbnail || cover.url || "";

            list.push({
                name: item.rus_name || item.name || item.eng_name || slug,
                imageUrl: imageUrl,
                link: slug
            });
        }

        return list;
    }

    async getPopular(page) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            page: page,
            sort_by: "views"
        });

        const list = this.parseMangaList(data);
        return { list: list, hasNextPage: list.length >= 20 };
    }

    async getLatestUpdates(page) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            page: page,
            sort_by: "last_chapter_at"
        });

        const list = this.parseMangaList(data);
        return { list: list, hasNextPage: list.length >= 20 };
    }

    async search(query, page, filters) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            q: query,
            page: page
        });

        const list = this.parseMangaList(data);
        return { list: list, hasNextPage: list.length >= 20 };
    }

    extractSlug(url) {
        if (!url) return "";

        const normalized = String(url).replace(/^https?:\/\/[^/]+/, "");
        const m = normalized.match(/(\d+--[a-z0-9\-]+)/i);
        if (m) return m[1];

        const m2 = normalized.match(/manga\/([^/?#]+)/i);
        if (m2) return m2[1];

        return normalized.replace(/^\/+|\/+$/g, "");
    }

    async getDetail(url) {
        const slug = this.extractSlug(url);

        const data = await this.requestApi(`/manga/${slug}`);
        const manga = data?.data || data || {};

        const cover = manga.cover || {};
        const imageUrl = cover.default || cover.md || cover.thumbnail || cover.url || "";

        let status = 5;
        const st = (manga.status?.label || "").toString().toLowerCase();
        if (st.includes("онгоинг") || st.includes("продолжается")) status = 0;
        else if (st.includes("заверш") || st.includes("закончен")) status = 1;
        else if (st.includes("заморож") || st.includes("приостанов")) status = 2;
        else if (st.includes("отмен")) status = 3;

        const chapters = [];
        let page = 1;
        let hasMore = true;

        while (hasMore && page <= 20) {
            const chaptersData = await this.requestApi(`/manga/${slug}/chapters`, { page: page });
            let items = [];

            if (Array.isArray(chaptersData?.data)) {
                items = chaptersData.data;
            } else if (Array.isArray(chaptersData)) {
                items = chaptersData;
            } else if (Array.isArray(chaptersData?.data?.data)) {
                items = chaptersData.data.data;
            } else if (Array.isArray(chaptersData?.data?.result)) {
                items = chaptersData.data.result;
            }

            if (!items.length) break;

            for (const ch of items) {
                if (!ch) continue;

                const volume = ch.volume ?? "0";
                const number = ch.number ?? "0";
                const chapterId = ch.id || ch.slug || ch.chapter_id || `${slug}-${volume}-${number}`;

                const chName = ch.name
                    ? `Том ${volume} Глава ${number} — ${ch.name}`
                    : `Том ${volume} Глава ${number}`;

                let dateUpload = "0";
                if (ch.branches && ch.branches.length > 0 && ch.branches[0].created_at) {
                    dateUpload = String(new Date(ch.branches[0].created_at).getTime());
                }

                let scanlator = "";
                if (ch.branches && ch.branches.length > 0 && ch.branches[0].teams) {
                    scanlator = ch.branches[0].teams.map(t => t.name).filter(Boolean).join(", ");
                }

                chapters.push({
                    name: chName,
                    url: `${slug}|${chapterId}|${volume}|${number}`,
                    dateUpload: dateUpload,
                    scanlator: scanlator
                });
            }

            page += 1;
            hasMore = items.length >= 20;
        }

        chapters.reverse();

        return {
            name: manga.rus_name || manga.name || manga.eng_name || slug,
            imageUrl: imageUrl,
            description: manga.summary || manga.description || "",
            author: "",
            status: status,
            genre: [],
            chapters: chapters
        };
    }

    async getPageList(chapterUrl) {
        const parts = String(chapterUrl).split("|");
        if (parts.length < 4) return [];

        const slug = parts[0];
        const chapterId = parts[1];
        const volume = parts[2];
        const number = parts[3];

        let data = null;

        if (chapterId && String(chapterId) !== "undefined") {
            data = await this.requestApi(`/manga/${slug}/chapter`, { id: chapterId });
        }

        if (!data || (!data?.data && !data?.pages && !Array.isArray(data))) {
            data = await this.requestApi(`/manga/${slug}/chapter`, {
                volume: volume,
                number: number
            });
        }

        const pagesRaw = data?.data?.pages || data?.pages || data?.data?.result || data?.result || [];
        const pages = [];
        const imgBase = "https://img3.cdnlibs.org";
        const headers = this.getImageHeaders();

        const rawPages = Array.isArray(pagesRaw) ? pagesRaw : [];

        for (const page of rawPages) {
            let path = "";
            if (typeof page === "string") {
                path = page;
            } else {
                path = page.url || page.image || page.src || "";
            }

            if (!path) continue;

            let finalUrl = "";
            if (path.startsWith("http://") || path.startsWith("https://")) {
                finalUrl = path;
            } else if (path.startsWith("//")) {
                finalUrl = "https:" + path;
            } else {
                finalUrl = imgBase + "/" + path.replace(/^\/+/, "");
            }

            pages.push({
                url: finalUrl,
                headers: headers
            });
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

module.exports = new DefaultExtension();
