'use strict';

const templates = require('./templates');
const engine = require('./engine');
const path = require('path');

// 自定义模板存在 data 目录，由 storage 注入（复用已有的 readJson/writeJson）
let storageRef = null;
function setStorage(storage) {
    storageRef = storage;
}

function customTemplates() {
    if (!storageRef) return [];
    return storageRef.readJson(path.join(storageRef.root, 'workflows', 'index.json'), []) || [];
}

/** 把项目当前的节点启停与参数固化成可复用模板 */
function saveTemplateFromProject(project, { name, description } = {}) {
    if (!storageRef) throw new Error('未注入 storage，无法保存模板');
    const overrides = project.workflow?.overrides || {};
    const base = templates[project.workflow?.templateId] || templates['vertical-15s'];
    const nodes = (project.workflow?.nodes || base.nodes).map(node => {
        const impl = engine.NODE_LIBRARY[node.id] || {};
        const override = overrides[node.id] || {};
        return {
            id: node.id,
            stage: node.stage || impl.stage || 'render',
            enabled: override.enabled !== undefined ? Boolean(override.enabled) : node.enabled !== false,
            params: { ...(node.params || {}), ...(override.params || {}) }
        };
    });
    const template = {
        id: `custom-${Date.now().toString(36)}`,
        name: name || `${project.name || '我的'}模板`,
        description: description || '由项目编排保存',
        builtin: false,
        nodes
    };
    storageRef.writeJson(path.join(storageRef.root, 'workflows', 'index.json'), [...customTemplates(), template]);
    return template;
}

function getTemplate(id) {
    if (id && templates[id]) return templates[id];
    if (id) {
        const custom = customTemplates().find(item => item.id === id);
        if (custom) return custom;
    }
    return templates['vertical-15s'];
}

function listTemplates() {
    return [...Object.values(templates), ...customTemplates()].map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        builtin: Boolean(template.builtin),
        nodeCount: template.nodes.length,
        stages: [...new Set(template.nodes.map(node => node.stage))]
    }));
}

/** 删除自定义模板（内置模板不可删） */
function deleteTemplate(id) {
    if (!storageRef) throw new Error('未注入 storage，无法删除模板');
    if (templates[id]) throw new Error('内置模板不可删除');
    const list = customTemplates();
    const target = list.find(item => item.id === id);
    if (!target) return null;
    storageRef.writeJson(
        path.join(storageRef.root, 'workflows', 'index.json'),
        list.filter(item => item.id !== id)
    );
    return target;
}

/** 重命名 / 改描述（仅自定义模板） */
function updateTemplate(id, { name, description } = {}) {
    if (!storageRef) throw new Error('未注入 storage，无法更新模板');
    if (templates[id]) throw new Error('内置模板不可编辑');
    const list = customTemplates();
    const target = list.find(item => item.id === id);
    if (!target) return null;
    if (name !== undefined) {
        const value = String(name).trim();
        if (value) target.name = value;
    }
    if (description !== undefined) target.description = String(description).trim();
    storageRef.writeJson(path.join(storageRef.root, 'workflows', 'index.json'), list);
    return target;
}

/** 模板里的节点定义（供前端工作流编辑器渲染） */
function describeTemplate(id) {
    const template = getTemplate(id);
    const nodes = engine.resolveNodes(template, {});
    return {
        ...template,
        nodes: nodes.map(node => ({
            id: node.id,
            label: node.label,
            stage: node.stage,
            enabled: node.enabled,
            requires: node.requires,
            produces: node.produces,
            providerKind: node.providerKind,
            params: node.params
        }))
    };
}

module.exports = {
    ...engine,
    getTemplate,
    listTemplates,
    deleteTemplate,
    updateTemplate,
    describeTemplate
    ,setStorage
    ,saveTemplateFromProject
    ,customTemplates
};
