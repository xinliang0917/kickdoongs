const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.dirname(__dirname);
const APP_NAME = '喵鳐';
const APP_ID = 'miaoyao-pet';
const APP_SLUG = 'miaoyao';
const BUNDLE_ID = 'com.miaoyao.pet';
const OUT_ROOT = process.env.PET_OUT ? path.resolve(process.env.PET_OUT) : path.join(ROOT, 'dist');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const APP_FILES = ['main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css'];
const PLATFORM = process.platform;
const ARCH = process.env.PET_ARCH || process.arch;
const MAKENSIS_CANDIDATES = [
  process.env.MAKENSIS,
  'makensis.exe',
  'C:\\Program Files (x86)\\NSIS\\makensis.exe',
  'C:\\Program Files\\NSIS\\makensis.exe',
];

function readRootPackage() {
  const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function ensureElectron(file) {
  const binary = path.join(ELECTRON_DIST, file);
  const crossArch = ARCH !== process.arch;
  const required =
    process.platform === 'win32'
      ? [
          'electron.exe',
          'icudtl.dat',
          'resources.pak',
          'snapshot_blob.bin',
          'v8_context_snapshot.bin',
          'ffmpeg.dll',
          'locales',
        ]
      : [file];
  const runtimeReady = () => {
    if (!required.every((name) => fs.existsSync(path.join(ELECTRON_DIST, name)))) return false;
    if (process.platform !== 'win32') return true;
    try {
      return fs.statSync(path.join(ELECTRON_DIST, 'icudtl.dat')).size > 1000000;
    } catch {
      return false;
    }
  };

  if (fs.existsSync(binary) && !crossArch && runtimeReady()) return;

  if (!crossArch) {
    fs.rmSync(ELECTRON_DIST, { recursive: true, force: true });
  }

  console.log(`Downloading Electron runtime for ${PLATFORM}-${ARCH}...`);
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'electron', 'install.js')], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_INSTALL_PLATFORM: PLATFORM, ELECTRON_INSTALL_ARCH: ARCH },
  });

  if (!fs.existsSync(binary)) {
    throw new Error('Electron runtime still missing after install. Run npm install first.');
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (runtimeReady()) return;
    sleepSync(250);
  }

  throw new Error(
    `Electron runtime is incomplete (missing ICU or support files): ${ELECTRON_DIST}`
  );
}

function copyAppFiles(appDir, rootPkg) {
  fs.mkdirSync(appDir, { recursive: true });
  for (const file of APP_FILES) {
    fs.copyFileSync(path.join(ROOT, file), path.join(appDir, file));
  }
  fs.cpSync(path.join(ROOT, 'assets'), path.join(appDir, 'assets'), { recursive: true });

  const appPkg = {
    name: APP_ID,
    productName: APP_NAME,
    version: rootPkg.version,
    description: rootPkg.description,
    main: 'main.js',
    private: true,
  };
  fs.writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function retrySync(label, fn, attempts = 10, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return fn();
    } catch (err) {
      lastError = err;
      console.log(`${label} failed (attempt ${attempt}/${attempts}): ${err.message}`);
      if (attempt < attempts) sleepSync(delayMs);
    }
  }
  throw lastError;
}

function resolveMakensis() {
  for (const candidate of MAKENSIS_CANDIDATES) {
    if (!candidate) continue;
    if (candidate === 'makensis.exe') {
      try {
        execFileSync('where.exe', ['makensis.exe'], { stdio: 'ignore' });
        return candidate;
      } catch {
        continue;
      }
    }
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function ensureNsisIcon() {
  const png = path.join(ROOT, 'assets', 'icon.png');
  if (!fs.existsSync(png)) return null;
  try {
    const data = fs.readFileSync(png);
    const header = Buffer.alloc(22);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt8(0, 6);
    header.writeUInt8(0, 7);
    header.writeUInt8(0, 8);
    header.writeUInt8(0, 9);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(data.length, 14);
    header.writeUInt32LE(22, 18);
    const ico = path.join(os.tmpdir(), `pet-${process.pid}.ico`);
    fs.writeFileSync(ico, Buffer.concat([header, data]));
    return ico;
  } catch (err) {
    console.warn(`icon generation skipped: ${err.message}`);
    return null;
  }
}

function buildWindowsInstaller(target, rootPkg) {
  const makensis = resolveMakensis();
  if (!makensis) {
    if (process.env.GITHUB_ACTIONS || process.env.REQUIRE_INSTALLER) {
      throw new Error('makensis not found. Install NSIS or set the MAKENSIS environment variable.');
    }
    console.warn('makensis not found; skipping Windows installer. Install NSIS or set MAKENSIS.');
    return null;
  }

  const setup = path.join(OUT_ROOT, `${APP_SLUG}-win32-${ARCH}-setup.exe`);
  const icon = ensureNsisIcon();
  const version = rootPkg.version
    .split('.')
    .concat(['0', '0', '0'])
    .slice(0, 4)
    .map((part) => parseInt(part, 10) || 0)
    .join('.');

  const lines = [
    'Unicode true',
    '!include "MUI2.nsh"',
    `Name "${APP_NAME}"`,
    `OutFile "${setup}"`,
    `InstallDir "$LOCALAPPDATA\\Programs\\${APP_NAME}"`,
    `InstallDirRegKey HKCU "Software\\${APP_NAME}" "InstallDir"`,
    'RequestExecutionLevel user',
    'SetCompressor /SOLID lzma',
    `VIProductVersion "${version}"`,
    `VIAddVersionKey "ProductName" "${APP_NAME}"`,
    `VIAddVersionKey "FileDescription" "${APP_NAME} 安装程序"`,
    `VIAddVersionKey "FileVersion" "${rootPkg.version}"`,
    `VIAddVersionKey "ProductVersion" "${rootPkg.version}"`,
  ];

  if (icon) {
    lines.push(`!define MUI_ICON "${icon}"`);
    lines.push(`!define MUI_UNICON "${icon}"`);
  }

  lines.push(
    '!define MUI_ABORTWARNING',
    `!define MUI_FINISHPAGE_RUN "$INSTDIR\\${APP_NAME}.exe"`,
    '!insertmacro MUI_PAGE_WELCOME',
    '!insertmacro MUI_PAGE_DIRECTORY',
    '!insertmacro MUI_PAGE_INSTFILES',
    '!insertmacro MUI_PAGE_FINISH',
    '!insertmacro MUI_UNPAGE_CONFIRM',
    '!insertmacro MUI_UNPAGE_INSTFILES',
    '!insertmacro MUI_LANGUAGE "SimpChinese"',
    'Section "Install"',
    '  SetOutPath "$INSTDIR"',
    `  File /r "${target}\\*.*"`,
    '  WriteUninstaller "$INSTDIR\\Uninstall.exe"',
    `  CreateDirectory "$SMPROGRAMS\\${APP_NAME}"`,
    `  CreateShortcut "$SMPROGRAMS\\${APP_NAME}\\${APP_NAME}.lnk" "$INSTDIR\\${APP_NAME}.exe"`,
    `  CreateShortcut "$DESKTOP\\${APP_NAME}.lnk" "$INSTDIR\\${APP_NAME}.exe"`,
    `  WriteRegStr HKCU "Software\\${APP_NAME}" "InstallDir" "$INSTDIR"`,
    `  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "DisplayName" "${APP_NAME}"`,
    `  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "DisplayVersion" "${rootPkg.version}"`,
    `  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "DisplayIcon" "$INSTDIR\\${APP_NAME}.exe"`,
    `  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "InstallLocation" "$INSTDIR"`,
    `  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "Publisher" "${APP_NAME}"`,
    `  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "UninstallString" "$INSTDIR\\Uninstall.exe"`,
    `  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "NoModify" 1`,
    `  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}" "NoRepair" 1`,
    'SectionEnd',
    'Section "Uninstall"',
    `  Delete "$DESKTOP\\${APP_NAME}.lnk"`,
    `  Delete "$SMPROGRAMS\\${APP_NAME}\\${APP_NAME}.lnk"`,
    `  RMDir "$SMPROGRAMS\\${APP_NAME}"`,
    '  Delete "$INSTDIR\\Uninstall.exe"',
    '  RMDir /r "$INSTDIR"',
    `  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}"`,
    `  DeleteRegKey HKCU "Software\\${APP_NAME}"`,
    'SectionEnd'
  );

  const script = path.join(os.tmpdir(), `pet-${process.pid}.nsi`);
  fs.writeFileSync(script, `\uFEFF${lines.join('\n')}\n`, 'utf8');
  console.log(`Building installer ${setup}...`);
  execFileSync(makensis, ['/V2', script], { stdio: 'inherit' });
  fs.rmSync(script, { force: true });
  return setup;
}

function buildWindows(rootPkg) {
  const target = path.join(OUT_ROOT, `${APP_NAME}-win32-${ARCH}`);
  ensureElectron('electron.exe');

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  const sourceExe = path.join(ELECTRON_DIST, 'electron.exe');
  const targetExe = path.join(target, 'electron.exe');
  console.log(`Copying electron.exe (source exists: ${fs.existsSync(sourceExe)})...`);
  let exeCopied = false;
  for (let attempt = 0; attempt < 3 && !exeCopied; attempt += 1) {
    try {
      fs.copyFileSync(sourceExe, targetExe);
      exeCopied = true;
    } catch (err) {
      console.log(`copy electron.exe failed (attempt ${attempt + 1}/3): ${err.message}`);
      fs.rmSync(ELECTRON_DIST, { recursive: true, force: true });
      ensureElectron('electron.exe');
    }
  }
  if (!exeCopied) {
    throw new Error('Could not copy electron.exe after reinstalling Electron');
  }

  console.log(`Copying Electron runtime to ${target}...`);
  retrySync(
    'copy Electron runtime',
    () => {
      fs.cpSync(ELECTRON_DIST, target, { recursive: true, dereference: true, force: true });
    },
    5,
    1000
  );

  console.log(
    `Runtime copy done (target exe: ${fs.existsSync(targetExe)}, source exe: ${fs.existsSync(sourceExe)})`
  );
  if (!fs.existsSync(targetExe)) {
    console.log('electron.exe missing after copy, copying it directly...');
    retrySync('copy electron.exe again', () => fs.copyFileSync(sourceExe, targetExe), 5, 1000);
  }
  if (!fs.existsSync(targetExe)) {
    const entries = fs.existsSync(target) ? fs.readdirSync(target).join(', ') : 'target missing';
    throw new Error(
      `electron.exe still missing (source exists: ${fs.existsSync(sourceExe)}); entries: ${entries}`
    );
  }

  console.log('Renaming Electron executable...');
  retrySync(
    'rename Electron executable',
    () => {
      fs.renameSync(targetExe, path.join(target, `${APP_NAME}.exe`));
    },
    15,
    1000
  );

  copyAppFiles(path.join(target, 'resources', 'app'), rootPkg);

  for (const entry of fs.readdirSync(ELECTRON_DIST, { withFileTypes: true })) {
    if (entry.name === 'electron.exe') continue;
    retrySync(
      `copy runtime ${entry.name}`,
      () => {
        fs.cpSync(path.join(ELECTRON_DIST, entry.name), path.join(target, entry.name), {
          recursive: true,
          force: true,
        });
      },
      5,
      1000
    );
  }
  retrySync(
    'copy app assets',
    () => {
      fs.cpSync(path.join(ROOT, 'assets'), path.join(target, 'resources', 'app', 'assets'), {
        recursive: true,
        force: true,
      });
    },
    5,
    1000
  );

  const zip = path.join(OUT_ROOT, `${APP_SLUG}-win32-${ARCH}.zip`);
  console.log(`Creating ${zip}...`);
  retrySync(
    'create zip',
    () => {
      fs.rmSync(zip, { force: true });
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${target}', '${zip}', [System.IO.Compression.CompressionLevel]::Optimal, $true)`,
        ],
        { stdio: 'inherit' }
      );
    },
    3,
    2000
  );

  const setup = buildWindowsInstaller(target, rootPkg);

  return { app: path.join(target, `${APP_NAME}.exe`), zip, setup };
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
  fs.mkdirSync(target, { recursive: true });

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

  const zip = path.join(OUT_ROOT, `${APP_SLUG}-darwin-${ARCH}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zip], {
    stdio: 'inherit',
  });

  let dmg = null;
  try {
    dmg = path.join(OUT_ROOT, `${APP_SLUG}-darwin-${ARCH}.dmg`);
    fs.rmSync(dmg, { force: true });
    console.log(`Creating ${dmg}...`);
    execFileSync(
      'hdiutil',
      ['create', '-volname', APP_NAME, '-srcfolder', bundle, '-ov', '-format', 'UDZO', dmg],
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.warn(`dmg creation skipped: ${err.message}`);
    dmg = null;
  }

  return { app: bundle, zip, dmg };
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
  if (result.setup) console.log(`setup: ${result.setup}`);
  if (result.dmg) console.log(`dmg: ${result.dmg}`);
}

try {
  main();
} catch (err) {
  const message = err.stack || err.message || String(err);
  console.error(message);
  if (process.env.GITHUB_ACTIONS) {
    const annotation = message.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
    console.log(`::error::${annotation}`);
  }
  process.exit(1);
}
