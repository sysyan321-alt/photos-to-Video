// 统一的 HTTP 封装：所有面板都通过这里访问后端

export async function api(path, options = {}) {
    const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    return data;
}

/** 产物文件地址（支持 Range，供 <video>/<img> 直接使用） */
export function fileUrl(filePath, download = false) {
    if (!filePath) return '';
    return `/api/files?path=${encodeURIComponent(filePath)}${download ? '&download=1' : ''}`;
}

/** 复制文本，优先用剪贴板 API，失败时退回 textarea 方案 */
export async function copyText(text, successMessage = '已复制', notify) {
    const value = String(text ?? '');
    if (!value.trim()) {
        notify?.('没有可复制的内容', 'error');
        return false;
    }
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
        } else {
            const area = document.createElement('textarea');
            area.value = value;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            document.body.removeChild(area);
        }
        notify?.(successMessage, 'success');
        return true;
    } catch (error) {
        notify?.(`复制失败: ${error.message}`, 'error');
        return false;
    }
}

/** 触发浏览器下载（用于导出提示词包等纯前端产物） */
export function downloadText(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
