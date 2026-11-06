const path = require('node:path');
const { makeHelpersExecutable } = require('./prepare-native.cjs');

module.exports = async context => {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app/Contents/Resources`)
    : path.join(context.appOutDir, 'resources');
  makeHelpersExecutable(path.join(resources, 'app.asar.unpacked/node_modules/node-pty'));
};
