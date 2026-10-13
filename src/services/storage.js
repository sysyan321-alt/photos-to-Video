'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../logger');

const log = createLogger('storage');

/**
 * 选择可用的产物根目录：优先配置值（容器内是 /data/growalbum），
 * 在没有该目录的宿主机（例如本机直接 node 起服务）自动退到仓库内 data/。
 */
function resolveRoot(preferred, appRoot) {
    const candidates = [preferred, path.join(appRoot, 'data')].filter(Boolean);
    let lastError = null;
    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        try {
            fs.mkdirSync(path.join(resolved, 'projects'), { recursive: true });
            if (resolved !== path.resolve(preferred)) {
                log.warn(`配置的产物目录 ${preferred} 不可用，改用 ${resolved}`);
            }
            return resolved;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('找不到可写的产物目录');
}

function createStorage(config) {
    const root = resolveRoot(config.outputRoot, config.appRoot);
    config.outputRoot = root;
    const projectsDir = path.join(root, 'projects');
    const briefsDir = path.join(root, 'briefs');
    const presetsDir = path.join(root, 'presets');
    const galleryDir = path.join(root, 'gallery');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(briefsDir, { recursive: true });
    fs.mkdirSync(presetsDir, { recursive: true });
    fs.mkdirSync(galleryDir, { recursive: true });

    const projectDir = id => path.join(projectsDir, id);

    function paths(id) {
        const base = projectDir(id);
        return {
            base,
            projectFile: path.join(base, 'project.json'),
            jobFile: path.join(base, 'job.json'),
            scriptFile: path.join(base, 'script.json'),
            storyboardFile: path.join(base, 'storyboard.json'),
            briefFile: path.join(base, 'brief.json'),
            keyframes: path.join(base, 'keyframes'),
            clips: path.join(base, 'clips'),
            audio: path.join(base, 'audio'),
            quietVideo: path.join(base, 'video'),
            output: path.join(base, 'output'),
            temp: path.join(base, 'tmp')
        };
    }

    function ensureProjectDirs(id) {
        const dirs = paths(id);
        for (const key of ['base', 'keyframes', 'clips', 'audio', 'quietVideo', 'output', 'temp']) {
            fs.mkdirSync(dirs[key], { recursive: true });
        }
        return dirs;
    }

    function writeJson(file, data) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    }

    function readJson(file, fallback = null) {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            return fallback;
        }
    }

    function saveProject(project) {
        writeJson(paths(project.id).projectFile, project);
        return project;
    }

    function getProject(id) {
        return readJson(paths(id).projectFile, null);
    }

    function listProjects() {
        let entries = [];
        try {
            entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        } catch (error) {
            return [];
        }
        return entries
            .filter(entry => entry.isDirectory())
            .map(entry => getProject(entry.name))
            .filter(Boolean)
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }

    function saveJob(job) {
        if (!job || !job.projectId) return;
        const dir = projectDir(job.projectId);
        if (!fs.existsSync(dir)) return;
        writeJson(path.join(dir, 'job.json'), job);
    }

    function newProjectId() {
        return `cd_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    }

    /** 删除项目目录（仅允许删除本项目根目录下、ID 合法的项目） */
    function deleteProject(id) {
        if (!/^cd_[a-z0-9_]+$/.test(String(id || ''))) {
            throw new Error('项目 ID 非法');
        }
        const target = path.join(projectsDir, id);
        if (path.dirname(target) !== projectsDir) {
            throw new Error('拒绝删除项目目录之外的路径');
        }
        if (!fs.existsSync(target)) return false;
        fs.rmSync(target, { recursive: true, force: true });
        return true;
    }

    /** Brief 独立于项目存储：可以先解析、复用、再挂到项目上 */
    function saveBrief(brief) {
        writeJson(path.join(briefsDir, `${brief.id}.json`), brief);
        return brief;
    }

    function getBrief(id) {
        if (!id) return null;
        return readJson(path.join(briefsDir, `${id}.json`), null);
    }

    function listBriefs() {
        let entries = [];
        try {
            entries = fs.readdirSync(briefsDir, { withFileTypes: true });
        } catch (error) {
            return [];
        }
        return entries
            .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
            .map(entry => readJson(path.join(briefsDir, entry.name), null))
            .filter(Boolean)
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }

    /** 提示词库：全局单文件；内置预设由 domain/preset 负责补齐 */
    function loadPresets() {
        return readJson(path.join(presetsDir, 'index.json'), null);
    }

    function savePresets(list) {
        writeJson(path.join(presetsDir, 'index.json'), list);
        return list;
    }

    /** 解析产物绝对路径，并确保落在输出根目录内（防目录穿越） */
    function resolveOutputFile(filePath) {
        const resolved = path.resolve(String(filePath || ''));
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
            throw new Error('仅允许访问输出目录内的文件');
        }
        return resolved;
    }

    return {
        root,
        projectsDir,
        briefsDir,
        presetsDir,
        galleryDir,
        paths,
        ensureProjectDirs,
        writeJson,
        readJson,
        saveProject,
        getProject,
        listProjects,
        saveJob,
        newProjectId,
        deleteProject,
        saveBrief,
        getBrief,
        listBriefs,
        loadPresets,
        savePresets,
        resolveOutputFile
    };
}

module.exports = { createStorage };
