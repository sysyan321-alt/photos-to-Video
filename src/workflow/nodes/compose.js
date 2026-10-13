'use strict';

const fs = require('fs');
const path = require('path');
const ffmpeg = require('../../services/ffmpeg');

/** 文件名按实际镜头数算时长：相册照片不足时成片会更短，名字要跟着变 */
function outputFileName(video, shotCount) {
    const seconds = Number((shotCount * video.shotSeconds).toFixed(2));
    return `growalbum_${video.width}x${video.height}_${seconds}s.mp4`;
}

module.exports = {
    id: 'compose',
    label: '合成导出',
    stage: 'render',
    // 有图生视频产物就用真视频，否则用关键帧做轻动态，两者满足其一即可
    requires: [['keyframe@shot', 'clip@shot']],
    produces: ['video'],
    providerKind: null,
    defaultEnabled: true,
    params: { subtitle: true },

    async run(ctx) {
        const font = ffmpeg.findCjkFont();
        const clips = [];
        let kenBurns = 0;

        for (let index = 0; index < ctx.project.shots.length; index += 1) {
            const shot = ctx.project.shots[index];
            const generated = ctx.project.assets.shotVideos?.[shot.shot_id];

            // 有 i2v 产物就用真视频，没有就走轻动态降级
            if (generated && fs.existsSync(generated)) {
                clips.push(generated);
                continue;
            }

            const keyframe = (ctx.project.assets.keyframes || [])[index];
            if (!keyframe?.path) throw new Error(`缺少镜头 ${shot.shot_id} 的关键帧，无法合成`);
            const outPath = path.join(ctx.dirs.clips, `${shot.shot_id}.mp4`);
            await ffmpeg.renderClip({
                imagePath: keyframe.path,
                outPath,
                camera: shot.camera,
                caption: shot.caption,
                font,
                video: ctx.video,
                tempDir: ctx.dirs.temp,
                index: index + 1
            });
            kenBurns += 1;
            clips.push(outPath);
        }

        const silentPath = path.join(ctx.dirs.quietVideo, 'silent.mp4');
        await ffmpeg.concatClips(clips, silentPath, path.join(ctx.dirs.temp, 'concat_video.txt'));

        const finalPath = path.join(ctx.dirs.output, outputFileName(ctx.video, ctx.project.shots.length));
        await ffmpeg.muxFinal({
            videoPath: silentPath,
            audioPath: ctx.project.assets.audio || null,
            outPath: finalPath
        });
        const probe = await ffmpeg.ffprobe(finalPath);
        const posterPath = await ffmpeg.extractPoster(
            finalPath,
            path.join(ctx.dirs.output, 'poster.jpg'),
            Math.max(0.1, probe.duration / 2)
        );

        ctx.project.assets.clips = clips;
        ctx.project.outputs = {
            video: finalPath,
            poster: posterPath,
            duration: probe.duration,
            sizeBytes: probe.sizeBytes,
            resolution: `${probe.width}x${probe.height}`,
            hasAudio: probe.hasAudio
        };
        ctx.project.status = 'completed';
        ctx.project.completedAt = new Date().toISOString();
        ctx.storage.saveProject(ctx.project);

        const megabytes = (probe.sizeBytes / 1024 / 1024).toFixed(2);
        return {
            detail: `${probe.width}x${probe.height} / ${probe.duration}s / ${megabytes}MB${kenBurns ? `（${kenBurns} 个镜头轻动态）` : ''}`,
            degraded: kenBurns > 0
        };
    }
};
