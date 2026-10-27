const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.dirname(__dirname);
const APP_NAME = '兔玹';
const BUNDLE_ID = 'com.tuxuan.pet';
const OUT_ROOT = process.env.PET_OUT ? path.resolve(process.env.PET_OUT) : path.join(ROOT, 'dist');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const APP_FILES = ['main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css'];
const PLATFORM = process.platform;
const ARCH = process.env.PET_ARCH || process.arch;

function readRootPackage() {
  const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function ensureElectron(file) {
  if (!fs.existsSync(path.join(ELECTRON_DIST, file))) {
    throw new Error('Electron runtime not found. Run npm install first.');
  }
}

function copyAppFiles(appDir, rootPkg) {
  fs.mkdirSync(appDir, { recursive: true });
  for (const file of APP_FILES) {
    fs.copyFileSync(path.join(ROOT, file), path.join(appDir, file));
  }
  fs.cpSync(path.join(ROOT, 'assets'), path.join(appDir, 'assets'), { recursive: true });

  const appPkg = {
    name: 'tuxuan-pet',
    productName: APP_NAME,
    version: rootPkg.version,
    description: rootPkg.description,
    main: 'main.js',
    private: true,
  };
  fs.writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`);
}

function buildWindows(rootPkg) {
  const target = path.join(OUT_ROOT, `${APP_NAME}-win32-${ARCH}`);
  ensureElectron('electron.exe');

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.cpSync(ELECTRON_DIST, target, { recursive: true });
  fs.renameSync(path.join(target, 'electron.exe'), path.join(target, `${APP_NAME}.exe`));

  copyAppFiles(path.join(target, 'resources', 'app'), rootPkg);

  const zip = path.join(OUT_ROOT, `${APP_NAME}-win32-${ARCH}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -LiteralPath '${target}' -DestinationPath '${zip}' -Force`,
    ],
    { stdio: 'inherit' }
  );

  return { app: path.join(target, `${APP_NAME}.exe`), zip };
}

function setPlistValue(plist, key, value) {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (!re.test(plist)) return plist;
  return plist.replace(re, `$1${value}$2`);
}

function patchPlist(file, rootPkg) {
  let plist = fs.readFileSync(file, 'utf8');
  plist = setPlistValue(plist, 'CFBundleExecutable', APP_NAME);
  plist = setPlistValue(plist, 'CFBundleName', APP_NAME);
  plist = setPlistValue(plist, 'CFBundleDisplayName', APP_NAME);
  plist = setPlistValue(plist, 'CFBundleIdentifier', BUNDLE_ID);
  plist = setPlistValue(plist, 'CFBundleShortVersionString', rootPkg.version);
  plist = setPlistValue(plist, 'CFBundleVersion', rootPkg.version);
  plist = setPlistValue(plist, 'CFBundleIconFile', 'icon.icns');
  fs.writeFileSync(file, plist);
}

function buildIcns(iconPng, outIcns) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-icns-'));
  const iconset = path.join(tmp, 'icon.iconset');
  fs.mkdirSync(iconset);
  const sizes = [
    [16, '16x16'],
    [32, '16x16@2x'],
    [32, '32x32'],
    [64, '32x32@2x'],
    [128, '128x128'],
    [256, '128x128@2x'],
    [256, '256x256'],
    [512, '256x256@2x'],
    [512, '512x512'],
    [1024, '512x512@2x'],
  ];
  for (const [size, name] of sizes) {
    execFileSync(
      'sips',
      ['-z', String(size), String(size), iconPng, '--out', path.join(iconset, `icon_${name}.png`)],
      { stdio: 'ignore' }
    );
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', outIcns], { stdio: 'ignore' });
  fs.rmSync(tmp, { recursive: true, force: true });
}

function buildMac(rootPkg) {
  ensureElectron('Electron.app');

  const target = path.join(OUT_ROOT, `${APP_NAME}-darwin-${ARCH}`);
  const bundle = path.join(target, `${APP_NAME}.app`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(OUT_ROOT, { recursive: true });

  execFileSync('ditto', [path.join(ELECTRON_DIST, 'Electron.app'), bundle], { stdio: 'inherit' });

  const oldExe = path.join(bundle, 'Contents', 'MacOS', 'Electron');
  const newExe = path.join(bundle, 'Contents', 'MacOS', APP_NAME);
  if (fs.existsSync(oldExe)) {
    fs.renameSync(oldExe, newExe);
    fs.chmodSync(newExe, 0o755);
  }

  const resources = path.join(bundle, 'Contents', 'Resources');
  try {
    buildIcns(path.join(ROOT, 'assets', 'icon.png'), path.join(resources, 'icon.icns'));
  } catch (err) {
    console.warn(`icon generation skipped: ${err.message}`);
  }

  patchPlist(path.join(bundle, 'Contents', 'Info.plist'), rootPkg);
  copyAppFiles(path.join(resources, 'app'), rootPkg);

  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
  } catch (err) {
    console.warn(`codesign skipped (install Xcode Command Line Tools to enable it): ${err.message}`);
  }

  const zip = path.join(OUT_ROOT, `${APP_NAME}-darwin-${ARCH}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zip], {
    stdio: 'inherit',
  });

  return { app: bundle, zip };
}

function main() {
  const rootPkg = readRootPackage();
  const result =
    PLATFORM === 'win32'
      ? buildWindows(rootPkg)
      : PLATFORM === 'darwin'
        ? buildMac(rootPkg)
        : null;
  if (!result) throw new Error(`Unsupported platform: ${PLATFORM}`);
  console.log(`app: ${result.app}`);
  console.log(`zip: ${result.zip}`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
