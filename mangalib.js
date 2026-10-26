// prettier-ignore
const mangayomiSources = [{
    "name": "MangaLib",
    "lang": "ru",
    "baseUrl": "https://mangalib.me",
    "apiUrl": "https://api.cdnlibs.org/api",
    "iconUrl": "https://mangalib.me/favicon.ico",
    "typeSource": "single",
    "itemType": 0,
    "version": "0.1.7",
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

    safeJsonParse(body) {
        if (body === null || body === undefined) return {};
        if (typeof body === "object") return body;

        const text = String(body).trim();
        if (!text) return {};

        try {
            return JSON.parse(text);
        } catch (e) {
            console.error("MangaLib JSON parse error:", e);
            return {};
        }
    }

    async requestApi(path, params = {}) {
        if (!this.client) this.client = new Client();

        let url = `${this.getApiUrl()}${path}`;
        const keys = Object.keys(params);

        if (keys.length > 0) {
            const query = keys
                .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
                .join("&");

            url += `?${query}`;
        }

        try {
            const res = await this.client.get(url, this.getHeaders());
            return this.safeJsonParse(res?.body);
        } catch (e) {
            console.error("MangaLib request failed:", path, e);
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
        } else if (data && data.data && Array.isArray(data.data.items)) {
            items = data.data.items;
        }

        for (const item of items) {
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
            page: page,
            sort_by: "views"
        });

        const list = this.parseMangaList(data);

        return {
            list: list,
            hasNextPage: list.length >= 20
        };
    }

    async getLatestUpdates(page) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            page: page,
            sort_by: "last_chapter_at"
        });

        const list = this.parseMangaList(data);

        return {
            list: list,
            hasNextPage: list.length >= 20
        };
    }

    async search(query, page, filters) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            q: query,
            page: page
        });

        const list = this.parseMangaList(data);

        return {
            list: list,
            hasNextPage: list.length >= 20
        };
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

    normalizeChaptersResponse(payload) {
        if (!payload) return [];

        const candidates = [
            payload,
            payload.data,
            payload.result,
            payload.items,
            payload.data?.data,
            payload.data?.items,
            payload.data?.chapters,
            payload.chapters
        ];

        for (const value of candidates) {
            if (Array.isArray(value)) return value;
        }

        return [];
    }

    getChaptersPageCount(payload) {
        const candidates = [
            payload?.meta,
            payload?.pagination,
            payload?.data?.meta,
            payload?.data?.pagination,
            payload?.data,
            payload
        ];

        for (const raw of candidates) {
            const total = Number(
                raw?.last_page ??
                raw?.lastPage ??
                raw?.total_pages ??
                raw?.totalPages ??
                raw?.pages ??
                0
            );

            if (Number.isFinite(total) && total > 0) {
                return total;
            }
        }

        return 0;
    }

    async getDetail(url) {
        const slug = this.extractSlug(url);

        if (!slug) {
            return {
                name: "",
                imageUrl: "",
                description: "",
                author: "",
                status: 5,
                genre: [],
                chapters: []
            };
        }

        const data = await this.requestApi(`/manga/${slug}`);
        const manga = data?.data || data || {};
        const cover = manga.cover || {};

        const imageUrl =
            cover.default ||
            cover.md ||
            cover.thumbnail ||
            "";

        let status = 5;
        const st = (manga.status?.label || "").toString().toLowerCase();

        if (st.includes("онгоинг") || st.includes("продолжается")) {
            status = 0;
        } else if (st.includes("заверш") || st.includes("закончен")) {
            status = 1;
        } else if (st.includes("заморож") || st.includes("приостанов")) {
            status = 2;
        } else if (st.includes("отмен")) {
            status = 3;
        }

        const chaptersMap = new Map();
        const seenPages = new Set();

        let page = 1;
        const maxPages = 200;

        // Загружаем страницы даже без метаданных пагинации.
        // Останавливаемся на пустой или повторяющейся странице.
        while (page <= maxPages) {
            const chaptersData = await this.requestApi(
                `/manga/${slug}/chapters`,
                { page: page }
            );

            const chaptersRaw =
                this.normalizeChaptersResponse(chaptersData);

            if (!chaptersRaw.length) break;

            const signature = chaptersRaw
                .map(ch =>
                    `${ch?.id ?? ""}:${ch?.volume ?? ch?.vol ?? ""}:${ch?.number ?? ch?.num ?? ""}:${ch?.slug ?? ""}`
                )
                .join(",");

            if (seenPages.has(signature)) break;
            seenPages.add(signature);

            for (const ch of chaptersRaw) {
                if (!ch) continue;

                const volume = String(ch.volume ?? ch.vol ?? "0");
                const number = String(ch.number ?? ch.num ?? "0");
                const key = `${volume}|${number}`;

                // Одна запись на том и номер главы.
                if (chaptersMap.has(key)) continue;

                const branch =
                    Array.isArray(ch.branches) && ch.branches.length > 0
                        ? ch.branches[0]
                        : {};

                const rawDate =
                    branch.created_at ||
                    ch.created_at ||
                    ch.updated_at ||
                    "0";

                const parsedDate = Number(
                    new Date(rawDate).getTime()
                );

                const dateUpload = Number.isFinite(parsedDate)
                    ? String(parsedDate)
                    : "0";

                let scanlator = "";

                if (branch && Array.isArray(branch.teams)) {
                    scanlator = branch.teams
                        .map(t => t?.name)
                        .filter(Boolean)
                        .join(", ");
                }

                const chapterName =
                    ch.name ||
                    ch.title ||
                    ch.slug ||
                    "";

                chaptersMap.set(key, {
                    name: chapterName
                        ? `Том ${volume} Глава ${number} — ${chapterName}`
                        : `Том ${volume} Глава ${number}`,

                    url: `${slug}|${volume}|${number}`,
                    dateUpload: dateUpload,
                    scanlator: scanlator
                });
            }

            const totalPages =
                this.getChaptersPageCount(chaptersData);

            if (totalPages && page >= totalPages) break;

            page += 1;
        }

        const chapters = [...chaptersMap.values()].sort((a, b) => {
            const aParts = String(a.url).split("|");
            const bParts = String(b.url).split("|");

            const aVol = Number(aParts[1] || 0);
            const bVol = Number(bParts[1] || 0);

            const aNum = Number(aParts[2] || 0);
            const bNum = Number(bParts[2] || 0);

            return (
                aVol * 100000 + aNum -
                (bVol * 100000 + bNum)
            );
        });

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

        const data = await this.requestApi(
            `/manga/${slug}/chapter`,
            {
                volume: volume,
                number: number
            }
        );

        const pagesRaw =
            data?.data?.pages ??
            data?.pages ??
            data?.data?.data?.pages ??
            data?.data?.items ??
            data?.items ??
            [];

        const pages = [];
        const imgBase = "https://img3.cdnlibs.org";
        const headers = this.getImageHeaders();

        for (const page of pagesRaw) {
            let path = "";

            if (typeof page === "string") {
                path = page;
            } else {
                path = page.url || page.image || page.path || "";
            }

            if (!path) continue;

            let finalUrl = "";

            if (
                path.startsWith("http://") ||
                path.startsWith("https://")
            ) {
                finalUrl = path;
            } else if (path.startsWith("//")) {
                finalUrl = "https:" + path;
            } else {
                finalUrl = `${imgBase}/${path.replace(/^\/+/, "")}`;
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
