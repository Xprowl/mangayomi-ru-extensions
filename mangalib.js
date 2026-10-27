// prettier-ignore
const mangayomiSources = [{
    "name": "MangaLib",
    "lang": "ru",
    "baseUrl": "https://mangalib.me",
    "apiUrl": "https://api.cdnlibs.org/api",
    "iconUrl": "https://mangalib.me/favicon.ico",
    "typeSource": "single",
    "itemType": 0,
    "version": "0.2.0",
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

    async requestApi(path, params) {
        if (!this.client) this.client = new Client();
        params = params || {};
        let url = this.getApiUrl() + path;
        const keys = Object.keys(params);
        if (keys.length > 0) {
            url += "?" + keys.map(function (k) {
                return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
            }).join("&");
        }
        const res = await this.client.get(url, this.getHeaders());
        return JSON.parse(res.body);
    }

    parseMangaList(data) {
        const list = [];
        let items = [];
        if (Array.isArray(data)) items = data;
        else if (data && Array.isArray(data.data)) items = data.data;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item) continue;
            const slug = item.slug_url || item.slug || String(item.id || "");
            if (!slug) continue;
            const cover = item.cover || {};
            list.push({
                name: item.rus_name || item.name || item.eng_name || slug,
                imageUrl: cover.default || cover.md || cover.thumbnail || "",
                link: slug
            });
        }
        return list;
    }

    async getPopular(page) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            "page": page,
            "sort_by": "views"
        });
        const list = this.parseMangaList(data);
        return { list: list, hasNextPage: list.length >= 20 };
    }

    async getLatestUpdates(page) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            "page": page,
            "sort_by": "last_chapter_at"
        });
        const list = this.parseMangaList(data);
        return { list: list, hasNextPage: list.length >= 20 };
    }

    async search(query, page, filters) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            "q": query,
            "page": page
        });
        const list = this.parseMangaList(data);
        return { list: list, hasNextPage: list.length >= 20 };
    }

    extractSlug(url) {
        if (!url) return "";
        url = String(url).replace(/^https?:\/\/[^/]+/, "");
        const m = url.match(/(\d+--[a-z0-9\-]+)/i);
        if (m) return m[1];
        const m2 = url.match(/manga\/([^/?#]+)/i);
        if (m2) return m2[1];
        return url.replace(/^\/+|\/+$/g, "");
    }

    async getDetail(url) {
        const slug = this.extractSlug(url);
        if (!slug) {
            return { name: "", imageUrl: "", description: "", author: "", status: 5, genre: [], chapters: [] };
        }

        const data = await this.requestApi("/manga/" + slug);
        const manga = (data && data.data) ? data.data : (data || {});
        const cover = manga.cover || {};
        const imageUrl = cover.default || cover.md || cover.thumbnail || "";

        let status = 5;
        const st = String((manga.status && manga.status.label) || "").toLowerCase();
        if (st.indexOf("онгоинг") !== -1 || st.indexOf("продолжается") !== -1) status = 0;
        else if (st.indexOf("заверш") !== -1 || st.indexOf("закончен") !== -1) status = 1;
        else if (st.indexOf("заморож") !== -1 || st.indexOf("приостанов") !== -1) status = 2;
        else if (st.indexOf("отмен") !== -1) status = 3;

        // Один запрос — API отдаёт все главы сразу
        const chaptersData = await this.requestApi("/manga/" + slug + "/chapters");
        let chaptersRaw = [];
        if (chaptersData && Array.isArray(chaptersData.data)) chaptersRaw = chaptersData.data;
        else if (Array.isArray(chaptersData)) chaptersRaw = chaptersData;

        const chapters = [];
        for (let i = 0; i < chaptersRaw.length; i++) {
            const ch = chaptersRaw[i];
            if (!ch) continue;

            const volume = String(ch.volume != null ? ch.volume : "0");
            const number = String(ch.number != null ? ch.number : "0");
            const title = ch.name ? ("Том " + volume + " Глава " + number + " — " + ch.name)
                                  : ("Том " + volume + " Глава " + number);

            let dateUpload = "0";
            let scanlator = "";
            if (ch.branches && ch.branches.length > 0) {
                const br = ch.branches[0];
                if (br.created_at) {
                    const t = new Date(br.created_at).getTime();
                    if (t && !isNaN(t)) dateUpload = String(t);
                }
                if (br.teams && br.teams.length) {
                    const names = [];
                    for (let j = 0; j < br.teams.length; j++) {
                        if (br.teams[j] && br.teams[j].name) names.push(br.teams[j].name);
                    }
                    scanlator = names.join(", ");
                }
            }

            chapters.push({
                name: title,
                url: slug + "|" + volume + "|" + number,
                dateUpload: dateUpload,
                scanlator: scanlator
            });
        }

        // Новые сверху
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
        if (parts.length < 3) return [];

        const slug = parts[0];
        const volume = parts[1];
        const number = parts[2];

        const data = await this.requestApi("/manga/" + slug + "/chapter", {
            volume: volume,
            number: number
        });

        let pagesRaw = [];
        if (data && data.data && Array.isArray(data.data.pages)) pagesRaw = data.data.pages;
        else if (data && Array.isArray(data.pages)) pagesRaw = data.pages;

        const pages = [];
        const imgBase = "https://img3.cdnlibs.org";
        const headers = this.getImageHeaders();

        for (let i = 0; i < pagesRaw.length; i++) {
            const page = pagesRaw[i];
            let path = "";
            if (typeof page === "string") path = page;
            else if (page) path = page.url || page.image || "";
            if (!path) continue;

            let finalUrl = "";
            if (path.indexOf("http://") === 0 || path.indexOf("https://") === 0) {
                finalUrl = path;
            } else if (path.indexOf("//") === 0) {
                finalUrl = imgBase + path.substring(1);
            } else {
                finalUrl = imgBase + "/" + path.replace(/^\//, "");
            }

            pages.push({ url: finalUrl, headers: headers });
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
