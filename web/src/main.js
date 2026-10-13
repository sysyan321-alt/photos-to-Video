import { createApp, defineComponent, onMounted, onUnmounted } from '/vendor/vue.esm-browser.prod.js';
import HomeView from './views/HomeView.js';
import WorkspaceView from './views/WorkspaceView.js';
import GalleryView from './views/GalleryView.js';
import ProjectsView from './views/ProjectsView.js';
import BatchView from './views/BatchView.js';
import AnalyticsView from './views/AnalyticsView.js';
import ProvidersView from './views/ProvidersView.js';
import AlbumFilterView from './views/AlbumFilterView.js';
import CreateProjectModal from './components/CreateProjectModal.js';
import PromptsModal from './components/PromptsModal.js';
import PreviewModal from './components/PreviewModal.js';
import Toast from './components/Toast.js';
import { state, actions } from './store.js';
import { fileUrl } from './api.js';

const App = defineComponent({
    name: 'App',
    components: { HomeView, GalleryView, ProjectsView, BatchView, AnalyticsView, ProvidersView, AlbumFilterView, WorkspaceView, CreateProjectModal, PromptsModal, PreviewModal, Toast },
    setup() {
        function onKeydown(event) {
            const meta = event.metaKey || event.ctrlKey;
            if (event.key === 'Escape') {
                state.create.open = false;
                state.promptsOpen = false;
                state.preview = { open: false, shot: null };
            }
            if (meta && event.key === 'Enter' && state.create.open) {
                event.preventDefault();
                actions.createProject();
            }
            if (meta && event.key.toLowerCase() === 's') {
                event.preventDefault();
                actions.saveDraft(true);
            }
        }

        onMounted(() => {
            actions.loadHealth();
            actions.loadProjects();
            actions.loadPresets();
            actions.loadTemplates();
            actions.restoreFromHash();
            // 支持 ?view=home|gallery|projects|batch|analytics|providers|filter 直接打开指定页面
            const wanted = new URLSearchParams(location.search).get('view');
            if (wanted && ['home', 'gallery', 'projects', 'batch', 'analytics', 'providers', 'filter'].includes(wanted)) {
                state.view = wanted;
            }
            window.addEventListener('keydown', onKeydown);
        });
        onUnmounted(() => window.removeEventListener('keydown', onKeydown));

        return { state };
    },
    template: `
        <HomeView v-if="state.view === 'home'" />
        <GalleryView v-else-if="state.view === 'gallery'" />
        <ProjectsView v-else-if="state.view === 'projects'" />
        <BatchView v-else-if="state.view === 'batch'" />
        <AnalyticsView v-else-if="state.view === 'analytics'" />
        <ProvidersView v-else-if="state.view === 'providers'" />
        <AlbumFilterView v-else-if="state.view === 'filter'" />
        <WorkspaceView v-else />

        <CreateProjectModal />
        <PromptsModal />
        <PreviewModal />
        <Toast :visible="state.toast.visible" :text="state.toast.text" :type="state.toast.type" />

        <div class="loading-overlay" v-if="state.loading.visible">
            <div class="loading-spinner"></div>
            <p>{{ state.loading.text }}</p>
        </div>
    `
});

const app = createApp(App);
// 模板里可以直接用 fileUrl() 拼产物地址（模板访问不到模块作用域的变量）
app.config.globalProperties.fileUrl = fileUrl;
// 导出实例，方便在控制台里调试（也便于静态自检识别入口模块）
export const mounted = app.mount('#app');
