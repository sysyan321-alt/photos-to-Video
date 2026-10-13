'use strict';

// 节点库：编排器按 id 取实现，模板只声明启停与参数
module.exports = {
    brief: require('./brief'),
    script: require('./script'),
    storyboard: require('./storyboard'),
    prompt_assembly: require('./prompt-assembly'),
    image_source: require('./image-source'),
    keyframe: require('./keyframe'),
    shot_video: require('./shot-video'),
    voice: require('./voice'),
    album_mv: require('./album-mv'),
    compose: require('./compose'),
    review: require('./review'),
    variants: require('./variants'),
    gate: require('./gate')
};
