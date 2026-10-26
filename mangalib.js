// prettier-ignore
const mangayomiSources = [{
    "name": "MangaLib",
    "lang": "ru",
    "baseUrl": "https://mangalib.me",
    "apiUrl": "https://api.imglib.info/api",
    "iconUrl": "https://mangalib.me/favicon.ico",
    "typeSource": "single",
    "itemType": 0,
    "version": "0.1.9",
    "isNsfw": false,
    "pkgPath": "manga/src/ru/mangalib.js"
}];

class DefaultExtension extends MProvider {
    getApiUrl() {
        return "https://api.imglib.info/api";
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
        if (!this.client) {
            this.client = new Client();
        }

        let url = `${this.getApiUrl()}${path}`;
        const keys = Object.keys(params);

        if (keys.length > 0) {
            const query = keys.map(k =>
                `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
            ).join("&");

            url += `?${query}`;
        }

        try {
            const res = await this.client.get(url, this.getHeaders());
            return this.safeJsonParse(res?.body);
        } catch (e) {
            console.error("MangaLib request failed:", url, e);
            return {};
        }
    }

    parseMangaList(data) {
        let items = [];

        if (Array.isArray(data)) {
            items = data;
        } else if (Array.isArray(data?.data)) {
            items = data.data;
        } else if (Array.isArray(data?.data?.data)) {
            items = data.data.data;
        } else if (Array.isArray(data?.data?.items)) {
            items = data.data.items;
        } else if (Array.isArray(data?.items)) {
            items = data.items;
        }

        const list = [];

        for (const item of items) {
            if (!item) continue;

            const slug =
                item.slug_url ||
                item.slug ||
                String(item.id || "");

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
            page,
            sort_by: "views"
        });

        const list = this.parseMangaList(data);

        return {
            list,
            hasNextPage: list.length >= 20
        };
    }

    async getLatestUpdates(page) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            page,
            sort_by: "last_chapter_at"
        });

        const list = this.parseMangaList(data);

        return {
            list,
            hasNextPage: list.length >= 20
        };
    }

    async search(query, page, filters) {
        const data = await this.requestApi("/manga", {
            "site_id[]": "1",
            q: query,
            page
        });

        const list = this.parseMangaList(data);

        return {
            list,
            hasNextPage: list.length >= 20
        };
    }

    extractSlug(url) {
        if (!url) return "";

        url = String(url).replace(/^https?:\/\/[^/]+/, "");

        const match = url.match(/(\d+--[a-z0-9-]+)/i);
        if (match) return match[1];

        const match2 = url.match(/manga\/([^/?#]+)/i);
        if (match2) return match2[1];

        return url.replace(/^\/+|\/+$/g, "");
    }

    normalizeChaptersResponse(payload) {
        if (!payload) return [];

        const candidates = [
            payload,
            payload.data,
            payload.result,
            payload.items,
            payload.chapters,
            payload.data?.data,
            payload.data?.items,
            payload.data?.chapters,
            payload.data?.data?.data,
            payload.data?.data?.items
        ];

        for (const candidate of candidates) {
            if (Array.isArray(candidate)) {
                return candidate;
            }
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

        for (const item of candidates) {
            const total = Number(
                item?.last_page ??
                item?.lastPage ??
                item?.total_pages ??
                item?.totalPages ??
                item?.pages ??
                0
            );

            if (Number.isFinite(total) && total > 0) {
                return total;
            }
        }

        return 0;
    }

    chapterNumberValue(value) {
        const s = String(value ?? "0").trim().replace(",", ".");
        const match = s.match(/-?\d+(?:\.\d+)?/);

        return match ? Number(match[0]) : 0;
    }

    async getDetail(url) {
        const slug = this.extractSlug(url);

        const empty = {
            name: "",
            imageUrl: "",
            description: "",
            author: "",
            status: 5,
            genre: [],
            chapters: []
        };

        if (!slug) return empty;

        const data = await this.requestApi(`/manga/${slug}`);
        const manga = data?.data || data || {};
        const cover = manga.cover || {};

        const imageUrl =
            cover.default ||
            cover.md ||
            cover.thumbnail ||
            "";

        let status = 5;
        const st = String(manga.status?.label || "").toLowerCase();

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

        while (page <= maxPages) {
            const chaptersData = await this.requestApi(
                `/manga/${slug}/chapters`,
                { page }
            );

            const chaptersRaw =
                this.normalizeChaptersResponse(chaptersData);

            if (chaptersRaw.length === 0) break;

            // Останавливаемся, если API повторно возвращает тот же список.
            const signature = chaptersRaw.map(ch =>
                `${ch?.id ?? ""}:${ch?.volume ?? ch?.vol ?? ""}:${ch?.number ?? ch?.num ?? ""}:${ch?.slug ?? ""}:${ch?.name ?? ch?.title ?? ""}`
            ).join(",");

            if (seenPages.has(signature)) break;
            seenPages.add(signature);

            for (const ch of chaptersRaw) {
                if (!ch) continue;

                const volume = String(ch.volume ?? ch.vol ?? "0");
                const number = String(ch.number ?? ch.num ?? "0");

                const id =
                    ch.id ??
                    ch.chapter_id ??
                    ch.chapterId;

                // Не удаляем разные главы только из-за совпадения номера.
                const key = id != null
                    ? `id:${id}`
                    : `${volume}|${number}|${ch.slug ?? ch.name ?? ch.title ?? ""}`;

                if (chaptersMap.has(key)) continue;

                const branches = Array.isArray(ch.branches)
                    ? ch.branches
                    : [];

                const branch = branches[0] || {};

                const rawDate =
                    branch.created_at ||
                    ch.created_at ||
                    ch.updated_at ||
                    "";

                const parsedDate = rawDate
                    ? new Date(rawDate).getTime()
                    : 0;

                const scanlator = Array.isArray(branch.teams)
                    ? branch.teams
                        .map(team => team?.name)
                        .filter(Boolean)
                        .join(", ")
                    : "";

                const chapterName =
                    ch.name ||
                    ch.title ||
                    ch.slug ||
                    "";

                chaptersMap.set(key, {
                    name: chapterName
                        ? `Том ${volume} Глава ${number} — ${chapterName}`
                        : `Том ${volume} Глава ${number}`,

                    // Формат сохраняем совместимым с getPageList().
                    url: `${slug}|${encodeURIComponent(volume)}|${encodeURIComponent(number)}`,

                    dateUpload: String(
                        Number.isFinite(parsedDate) ? parsedDate : 0
                    ),

                    scanlator
                });
            }

            const totalPages =
                this.getChaptersPageCount(chaptersData);

            if (totalPages > 0 && page >= totalPages) {
                break;
            }

            page += 1;
        }

        const chapters = [...chaptersMap.values()].sort((a, b) => {
            const aParts = String(a.url).split("|");
            const bParts = String(b.url).split("|");

            const aVolume = this.chapterNumberValue(
                decodeURIComponent(aParts[1] || "0")
            );

            const bVolume = this.chapterNumberValue(
                decodeURIComponent(bParts[1] || "0")
            );

            const aNumber = this.chapterNumberValue(
                decodeURIComponent(aParts[2] || "0")
            );

            const bNumber = this.chapterNumberValue(
                decodeURIComponent(bParts[2] || "0")
            );

            return aVolume - bVolume || aNumber - bNumber;
        });

        return {
            name: manga.rus_name || manga.name || manga.eng_name || slug,
            imageUrl,
            description: manga.summary || manga.description || "",
            author: "",
            status,
            genre: [],
            chapters
        };
    }

    async getPageList(chapterUrl) {
        const parts = String(chapterUrl).split("|");

        if (parts.length < 3) return [];

        const slug = parts[0];
        const volume = decodeURIComponent(parts[1]);
        const number = decodeURIComponent(parts[2]);

        const data = await this.requestApi(
            `/manga/${slug}/chapter`,
            {
                volume,
                number
            }
        );

        const pagesRaw =
            data?.data?.pages ??
            data?.pages ??
            data?.data?.data?.pages ??
            data?.data?.items ??
            data?.items ??
            [];

        if (!Array.isArray(pagesRaw)) return [];

        const pages = [];
        const imgBase = "https://img3.cdnlibs.org";
        const headers = this.getImageHeaders();

        for (const item of pagesRaw) {
            let path = "";

            if (typeof item === "string") {
                path = item;
            } else if (item) {
                path = item.url || item.image || item.path || "";
            }

            if (!path) continue;

            let finalUrl;

            if (/^https?:\/\//i.test(path)) {
                finalUrl = path;
            } else if (path.startsWith("//")) {
                finalUrl = `https:${path}`;
            } else {
                finalUrl = `${imgBase}/${path.replace(/^\/+/, "")}`;
            }

            pages.push({
                url: finalUrl,
                headers
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
