import { defineComponent } from '/vendor/vue.esm-browser.prod.js';
import NavBar from '../components/NavBar.js';
import { fileUrl } from '../api.js';
import { state, actions } from '../store.js';

const GALLERY_MENU = [
    { key: 'home', label: '首页' },
    { key: 'projects', label: '作品' },
    { key: 'gallery', label: '我的相册' },
    { key: 'filter', label: '图片筛选' },
    { key: 'prompts', label: '提示词库' }
];

/** 个人相册：左侧分组，右侧照片网格，支持上传 / 打标 / 一键出相册 MV */
export default defineComponent({
    name: 'GalleryView',
    components: { NavBar },
    data() {
        return {
            state,
            menu: GALLERY_MENU,
            activeMenu: 'gallery',
            newAlbumName: '',
            uploadNote: '',
            mvOptions: { pick: 'sequential', caption: 'note', title: '' }
        };
    },
    computed: {
        album() {
            return state.currentAlbum;
        },
        photoCount() {
            return state.photos.length;
        },
        estimate() {
            // 相册 MV 的时长 = 照片数 × 单镜头秒数（不足时会比目标时长短）
            const perShot = 3;
            return this.photoCount * perShot;
        }
    },
    mounted() {
        actions.loadAlbums();
    },
    methods: {
        ...actions,
        thumbOf(photo) {
            return photo.thumb ? fileUrl(photo.thumb) : fileUrl(photo.file);
        },
        openFull(photo) {
            window.open(fileUrl(photo.file), '_blank');
        },
        openAlbum(albumId) {
            actions.openAlbum(albumId);
        },
        async createAlbum() {
            await actions.createAlbum(this.newAlbumName);
            this.newAlbumName = '';
        },
        async onFiles(event) {
            await actions.uploadPhotos(event.target.files, this.uploadNote);
            event.target.value = '';
        },
        async renameNote(photo, value) {
            await actions.updatePhoto(photo.id, { note: value });
        },
        async startMv() {
            if (!this.album) return this.notify('请先选择相册', 'error');
            if (!this.photoCount) return this.notify('相册里还没有照片', 'error');
            await actions.makeAlbumMv(this.album.id, this.mvOptions);
        },
        onMenu(key) {
            if (key === 'home') state.view = 'home';
            if (key === 'projects') state.view = 'projects';
            if (key === 'filter') state.view = 'filter';
            if (key === 'prompts') state.promptsOpen = true;
        }
    },
    template: `
        <div class="container">
            <header class="home-header">
                <h1>我的相册<span class="sub">Gallery</span></h1>
                <div class="header-actions">
                    <NavBar :items="menu" v-model="activeMenu" size="sm" align="end" @select="onMenu" />
                    <button class="btn-secondary" @click="state.promptsOpen = true">管理提示词</button>
                </div>
            </header>

            <div class="gallery-layout">
                <aside class="card gallery-albums">
                    <h3>相册分组</h3>
                    <div class="row-actions" style="margin: 0.8rem 0;">
                        <input class="input-field" v-model="newAlbumName" placeholder="新相册名称" @keyup.enter="createAlbum()">
                        <button class="btn-primary" @click="createAlbum()">新建</button>
                    </div>
                    <div class="album-list">
                        <div v-for="item in state.albums" :key="item.id" class="album-item"
                             :class="{ active: album && album.id === item.id }" @click="openAlbum(item.id)">
                            <div class="album-cover">
                                <img v-if="item.cover" :src="fileUrl(item.cover.thumb || item.cover.file)" :alt="item.name">
                                <span v-else>空</span>
                            </div>
                            <div class="album-meta">
                                <strong>{{ item.name }}</strong>
                                <small>{{ item.count }} 张</small>
                            </div>
                            <button class="btn-delete" @click.stop="deleteAlbum(item.id, item.name)">删除</button>
                        </div>
                        <p class="hint" v-if="!state.albums.length">还没有相册，先新建一个分组</p>
                    </div>
                </aside>

                <section class="card gallery-photos">
                    <div class="card-header-with-btn">
                        <h3>{{ album ? album.name : '未选择相册' }}</h3>
                        <div class="row-actions" v-if="album">
                            <span class="tag">{{ photoCount }} 张</span>
                            <span class="tag">预计 {{ estimate }} 秒成片</span>
                        </div>
                    </div>

                    <div class="gallery-toolbar" v-if="album">
                        <input class="input-field" v-model="uploadNote" placeholder="本批照片的备注（会作为字幕）">
                        <label class="btn-secondary file-btn">
                            {{ state.upload.busy ? ('上传中 ' + state.upload.done + '/' + state.upload.total) : '上传照片' }}
                            <input type="file" accept="image/*" multiple @change="onFiles" hidden>
                        </label>
                        <select class="input-field" v-model="mvOptions.pick">
                            <option value="sequential">按顺序选图</option>
                            <option value="random">随机选图</option>
                            <option value="latest">优先最新</option>
                            <option value="score">AI 分数优先</option>
                        </select>
                        <select class="input-field" v-model="mvOptions.caption">
                            <option value="note">用备注当字幕</option>
                            <option value="none">不加字幕</option>
                        </select>
                        <button class="btn-primary" @click="startMv()">一键生成相册 MV</button>
                    </div>

                    <div class="photo-grid" v-if="photoCount">
                        <div class="photo-card" v-for="photo in state.photos" :key="photo.id">
                            <img :src="thumbOf(photo)" :alt="photo.name" @click="openFull(photo)">
                            <div class="photo-body">
                                <input class="input-field" :value="photo.note" placeholder="备注（字幕）"
                                       @change="renameNote(photo, $event.target.value)">
                                <div class="photo-meta">
                                    <span class="tag" v-if="photo.width">{{ photo.width }}×{{ photo.height }}</span>
                                    <button class="btn-delete" @click="deletePhoto(photo.id)">删除</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="asset-empty" v-else-if="album">这个相册还没有照片，上传几张试试</div>
                    <div class="asset-empty" v-else>左侧选择或新建一个相册</div>
                </section>
            </div>
        </div>
    `
});
