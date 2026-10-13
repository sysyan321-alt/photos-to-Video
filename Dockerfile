FROM node:20-alpine

# 默认的 dl-cdn 源在国内很慢，换成镜像源；可用 APK_MIRROR 覆盖
ARG APK_MIRROR=mirrors.aliyun.com
RUN sed -i "s|dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories

# ffmpeg 负责成片渲染，fontconfig + CJK 字体负责字幕/标签
RUN apk add --no-cache ffmpeg fontconfig ttf-dejavu \
 && (apk add --no-cache font-wqy-zenhei \
     || apk add --no-cache font-noto-cjk \
     || apk add --no-cache font-wqy-microhei \
     || true) \
 && fc-cache -f

WORKDIR /app

# 本项目零 npm 依赖，直接拷贝源码即可，构建无需访问 npm registry
COPY package.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts

ENV NODE_ENV=production \
    PORT=8787 \
    COMIC_OUTPUT_ROOT=/data/comicdrama

EXPOSE 8787

CMD ["node", "src/index.js"]
