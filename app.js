/**
 * FlipBuilder Audio Extractor - Logic Engine
 * Final Version - Extremely Robust with Fail-safes
 */

document.addEventListener('DOMContentLoaded', () => {
    const extractBtn = document.getElementById('extractBtn');
    const targetUrlInput = document.getElementById('targetUrl');
    const audioList = document.getElementById('audioList');
    const totalAudiosEl = document.getElementById('totalAudios');
    const totalPagesEl = document.getElementById('totalPages');
    const statusEl = document.getElementById('extractionStatus');
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    const themeToggle = document.getElementById('themeToggle');
    const audioPreview = document.getElementById('audioPreview');

    let extractedData = [];

    // --- Theme Management ---
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        const icon = themeToggle.querySelector('i');
        icon.className = document.body.classList.contains('light-theme') ? "fas fa-sun" : "fas fa-moon";
    });

    // --- Manual Fallback Logic ---
    const manualInputBtn = document.getElementById('manualInputBtn');
    const manualArea = document.getElementById('manualArea');
    const parseManualBtn = document.getElementById('parseManualBtn');
    const manualConfigText = document.getElementById('manualConfigText');

    manualInputBtn.addEventListener('click', () => {
        const isHidden = manualArea.style.display === 'none';
        manualArea.style.display = isHidden ? 'block' : 'none';
        manualInputBtn.innerHTML = isHidden ? 'Đóng nhâp liệu <i class="fas fa-times"></i>' : 'Nhập thủ công <i class="fas fa-edit"></i>';
    });

    parseManualBtn.addEventListener('click', () => {
        const content = manualConfigText.value.trim();
        const rawUrl = targetUrlInput.value.trim();
        
        if (!rawUrl || !rawUrl.startsWith('http')) {
            alert('Vui lòng nhập Link trang web FlipBuilder gốc vào ô tìm kiếm ở trên trước khi bấm Phân tích thủ công (Để ứng dụng biết địa chỉ máy chủ của bạn)!');
            return;
        }

        const baseUrl = cleanBaseUrl(rawUrl);
        if (!content) return showToast('Vui lòng dán nội dung config.js!', 'error');

        try {
            statusEl.innerText = 'Đang phân tích thủ công...';
            const pageEditor = parseVariable(content, 'pageEditor');
            const bmtConfig = parseVariable(content, 'bmtConfig');
            if (!pageEditor) throw new Error('Không tìm thấy dữ liệu pageEditor.');
            extractedData = processAudioData(pageEditor, bmtConfig, baseUrl);
            renderResults(extractedData);
            
            totalAudiosEl.innerText = extractedData.length;
            totalPagesEl.innerText = pageEditor.pageAnnos ? pageEditor.pageAnnos.length : '0';
            statusEl.innerText = 'Hoàn tất (Thủ công)';
            downloadAllBtn.disabled = extractedData.length === 0;
            showToast('Phân tích thủ công thành công!', 'success');
            manualArea.style.display = 'none';
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // --- Core Data Fetcher with Proxy Rotation & Direct Fallback ---
    async function fetchWithProxy(url, isRaw = false) {
        let lastError = null;

        // 1. Try DIRECT first (No Proxy) - sometimes this works and is fastest
        try {
            console.log(`Trying direct fetch: ${url}`);
            const directResp = await fetch(url, { mode: 'no-cors' }); 
            // Note: no-cors doesn't allow reading body, but for <audio> it might be enough.
            // However, for blob extraction, we need cors.
            const corsResp = await fetch(url);
            if (corsResp.ok) {
                return isRaw ? await corsResp.blob() : await corsResp.text();
            }
        } catch (e) {
            console.warn('Direct fetch blocked by CORS, trying proxies...');
        }

        // 2. Rotate through proxies
        const proxyGenerators = [
            (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
            (u) => `https://api.allorigins.win/${isRaw ? 'raw?url=' : 'get?url='}${encodeURIComponent(u)}`,
            (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
        ];

        for (const getProxyUrl of proxyGenerators) {
            try {
                const pUrl = getProxyUrl(url);
                statusEl.innerText = `🔄 Thử qua ${pUrl.split('/')[2]}...`;
                const response = await fetch(pUrl);
                if (!response.ok) throw new Error(`Proxy status ${response.status}`);
                if (isRaw) return await response.blob();
                if (pUrl.includes('allorigins')) {
                    const data = await response.json();
                    return data.contents;
                }
                return await response.text();
            } catch (e) {
                console.warn(`Proxy failed:`, e);
                lastError = e;
            }
        }
        throw new Error(lastError ? lastError.message : 'Tất cả kết nối đều thất bại.');
    }

    // --- Core Logic ---
    extractBtn.addEventListener('click', async () => {
        let rawUrl = targetUrlInput.value.trim();
        if (!rawUrl) return showToast('Vui lòng nhập URL!', 'error');
        startLoading();
        try {
            const baseUrl = cleanBaseUrl(rawUrl);
            const configUrl = `${baseUrl}mobile/javascript/config.js`;
            const scriptContent = await fetchWithProxy(configUrl);
            const pageEditor = parseVariable(scriptContent, 'pageEditor');
            const bmtConfig = parseVariable(scriptContent, 'bmtConfig');
            if (!pageEditor) throw new Error('Không thể phân tích dữ liệu tệp cấu hình.');
            extractedData = processAudioData(pageEditor, bmtConfig, baseUrl);
            renderResults(extractedData);
            totalAudiosEl.innerText = extractedData.length;
            totalPagesEl.innerText = pageEditor.pageAnnos ? pageEditor.pageAnnos.length : 'Đã ẩn';
            statusEl.innerText = 'Hoàn tất';
            downloadAllBtn.disabled = extractedData.length === 0;
            showToast(`Tìm thấy ${extractedData.length} tệp!`, 'success');
        } catch (error) {
            alert('Lỗi: ' + error.message + '\n\nHãy thử dùng tính năng "Nhập thủ công" bên dưới.');
            resetUI();
        } finally {
            stopLoading();
        }
    });

    // --- Helper Functions ---
    function cleanBaseUrl(url) {
        let clean = url.split('?')[0].split('#')[0];
        clean = clean.replace(/\/(config\.js|index\.html|index\.htm)$/i, '');
        clean = clean.replace(/\/mobile\/javascript(\/)?$/i, '');
        if (!clean.endsWith('/')) clean += '/';
        return clean;
    }

    function parseVariable(content, varName) {
        try {
            const regex = new RegExp(`${varName}\\s*=\\s*({[\\s\\S]*?});|${varName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`, 'm');
            const match = content.match(regex);
            if (match) {
                const jsonStr = match[1] || match[2];
                return Function('"use strict";return (' + jsonStr.replace(/;\s*$/, '') + ')')();
            }
        } catch (e) {}
        return null;
    }

    function processAudioData(pageEditor, bmtConfig, baseUrl) {
        const results = [];
        const bookmarks = bmtConfig || [];
        if (!pageEditor.pageAnnos) return results;
        pageEditor.pageAnnos.forEach((annos, index) => {
            if (!annos) return;
            annos.forEach(anno => {
                if (anno.annotype === "com.mobiano.flipbook.pageeditor::TAnnoPlugIn" && 
                    anno.componentData && anno.componentData.songs) {
                    const song = anno.componentData.songs.song;
                    if (song && song.url) {
                        const pageNum = index + 1;
                        let title = `Âm thanh trang ${pageNum}`;
                        const matchingBmt = bookmarks.find(b => b.pageIndex === index);
                        if (matchingBmt) title = matchingBmt.title;
                        const relativePath = song.url.startsWith('./') ? song.url.substring(2) : song.url;
                        const fullUrl = encodeURI(baseUrl + relativePath);
                        results.push({
                            id: results.length + 1,
                            title: title,
                            originalName: decodeURIComponent(relativePath.split('/').pop().split('?')[0]),
                            pageNum: pageNum,
                            url: fullUrl
                        });
                    }
                }
            });
        });
        return results;
    }

    function renderResults(data) {
        if (data.length === 0) {
            audioList.innerHTML = `<tr><td colspan="5" class="empty-state">Không tìm thấy âm thanh.</td></tr>`;
            return;
        }
        audioList.innerHTML = data.map(item => `
            <tr class="fade-in">
                <td>${item.id}</td>
                <td class="font-bold">${item.title}</td>
                <td class="text-secondary"><small>${item.originalName}</small></td>
                <td><span class="badge">Trang ${item.pageNum}</span></td>
                <td>
                    <div class="action-btns">
                        <a href="${item.url}" target="_blank" class="control-btn link-btn" title="Mở âm thanh">
                            <i class="fas fa-external-link-alt"></i>
                        </a>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // --- Global Handlers ---
    window.previewAudio = async (url, btn) => {
        const icon = btn.querySelector('i');
        if (audioPreview.src.startsWith('blob:') && !audioPreview.paused) {
            audioPreview.pause();
            icon.className = "fas fa-play";
            return;
        }
        document.querySelectorAll('.play-btn i').forEach(i => i.className = "fas fa-play");
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        statusEl.innerText = 'Đang tải âm thanh...';

        try {
            const blob = await fetchWithProxy(url, true);
            const blobUrl = window.URL.createObjectURL(blob);
            audioPreview.src = blobUrl;
            audioPreview.play();
            btn.innerHTML = '<i class="fas fa-pause"></i>';
            statusEl.innerText = 'Đang phát';
            audioPreview.onended = () => {
                btn.innerHTML = '<i class="fas fa-play"></i>';
                window.URL.revokeObjectURL(blobUrl);
            };
        } catch (e) {
            btn.innerHTML = '<i class="fas fa-play"></i>';
            statusEl.innerText = 'Lỗi phát nhạc';
            // If proxy fails, try DIRECT play as last resort
            showToast('Proxy lỗi, thử phát trực tiếp...', 'info');
            audioPreview.src = url;
            audioPreview.play().catch(() => {
                alert('Không thể phát file này. Hãy nhấn nút "Mở trực tiếp" bên cạnh để nghe.');
            });
        }
    };

    window.downloadFile = async (url, filename, btn) => {
        const oIcon = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;
        try {
            const blob = await fetchWithProxy(url, true);
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
            showToast('Tải xong!', 'success');
        } catch (e) {
            window.open(url, '_blank');
            showToast('Đang mở file trực tiếp...', 'info');
        } finally {
            btn.innerHTML = oIcon; btn.disabled = false;
        }
    };

    function startLoading() { extractBtn.disabled = true; extractBtn.classList.add('loading'); }
    function stopLoading() { extractBtn.disabled = false; extractBtn.classList.remove('loading'); }
    function resetUI() { audioList.innerHTML = ''; }
    function showToast(msg, type) { console.log(`[${type}] ${msg}`); }
});
