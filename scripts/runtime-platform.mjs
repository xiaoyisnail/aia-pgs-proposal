import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function pathApi(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function pathsOverlap(firstPath, secondPath, platform = process.platform) {
  const paths = pathApi(platform);
  const normalize = value => {
    const resolved = paths.normalize(paths.resolve(value));
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const first = normalize(firstPath);
  const second = normalize(secondPath);
  const isSameOrChild = (candidate, parent) => {
    const relative = paths.relative(parent, candidate);
    return relative === ''
      || (!relative.startsWith(`..${paths.sep}`)
        && relative !== '..'
        && !paths.isAbsolute(relative));
  };
  return isSameOrChild(first, second) || isSameOrChild(second, first);
}

function resolveUserPath(value, {
  platform = process.platform,
  home = os.homedir(),
} = {}) {
  const paths = pathApi(platform);
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return paths.join(home, value.slice(2));
  }
  return paths.resolve(value);
}

function resolveConfigDir({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const paths = pathApi(platform);
  if (env.AIA_PGS_CONFIG_DIR) {
    return resolveUserPath(env.AIA_PGS_CONFIG_DIR, { platform, home });
  }
  if (platform === 'win32') {
    return paths.join(
      env.APPDATA || env.AppData || paths.join(home, 'AppData', 'Roaming'),
      'aia-pgs',
    );
  }
  return paths.join(env.XDG_CONFIG_HOME || paths.join(home, '.config'), 'aia-pgs');
}

function resolveConfigPath(options) {
  const platform = options?.platform || process.platform;
  const env = options?.env || process.env;
  const home = options?.home || os.homedir();
  if (env.AIA_PGS_CONFIG_PATH) {
    return resolveUserPath(env.AIA_PGS_CONFIG_PATH, { platform, home });
  }
  return pathApi(options?.platform || process.platform).join(
    resolveConfigDir(options),
    'config.json',
  );
}

function resolveProfileDir({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  exists = fs.existsSync,
} = {}) {
  const paths = pathApi(platform);
  if (env.AIA_PGS_PROFILE_DIR) {
    return resolveUserPath(env.AIA_PGS_PROFILE_DIR, { platform, home });
  }

  if (platform === 'darwin') {
    const legacyProfile = paths.join(
      home,
      'Library',
      'Application Support',
      'Google',
      'Chrome-Debug',
    );
    if (exists(legacyProfile)) return legacyProfile;
    return paths.join(home, 'Library', 'Application Support', 'AIA-PGS-Automation');
  }
  if (platform === 'win32') {
    return paths.join(
      env.LOCALAPPDATA || env.LocalAppData || paths.join(home, 'AppData', 'Local'),
      'AIA-PGS-Automation',
    );
  }
  return paths.join(env.XDG_CONFIG_HOME || paths.join(home, '.config'), 'aia-pgs-automation');
}

function resolveDefaultChromeDir({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const paths = pathApi(platform);
  if (platform === 'darwin') {
    return paths.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  }
  if (platform === 'win32') {
    return paths.join(
      env.LOCALAPPDATA || env.LocalAppData || paths.join(home, 'AppData', 'Local'),
      'Google',
      'Chrome',
      'User Data',
    );
  }
  return paths.join(env.XDG_CONFIG_HOME || paths.join(home, '.config'), 'google-chrome');
}

function profileOverlapsDefaultChrome(options = {}) {
  const platform = options.platform || process.platform;
  const realpath = options.realpath || fs.realpathSync.native;
  const canonical = value => {
    const paths = pathApi(platform);
    const suffix = [];
    let candidate = paths.resolve(value);
    try {
      return realpath(candidate);
    } catch {}
    while (true) {
      const parent = paths.dirname(candidate);
      if (parent === candidate) return paths.resolve(value);
      suffix.unshift(paths.basename(candidate));
      candidate = parent;
      try {
        return paths.join(realpath(candidate), ...suffix);
      } catch {}
    }
  };
  return pathsOverlap(
    canonical(resolveProfileDir(options)),
    canonical(resolveDefaultChromeDir(options)),
    platform,
  );
}

function chromeExecutableCandidates({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const paths = pathApi(platform);
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      paths.join(home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    ];
  }
  if (platform === 'win32') {
    return [
      env.PROGRAMFILES || env.ProgramFiles,
      env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'],
      env.LOCALAPPDATA || env.LocalAppData,
    ].filter(Boolean).map(base => paths.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
  ];
}

function findChromeExecutable(options) {
  return chromeExecutableCandidates(options).find(candidate => fs.existsSync(candidate)) || '';
}

export {
  chromeExecutableCandidates,
  findChromeExecutable,
  pathsOverlap,
  profileOverlapsDefaultChrome,
  resolveConfigDir,
  resolveConfigPath,
  resolveDefaultChromeDir,
  resolveProfileDir,
  resolveUserPath,
};
