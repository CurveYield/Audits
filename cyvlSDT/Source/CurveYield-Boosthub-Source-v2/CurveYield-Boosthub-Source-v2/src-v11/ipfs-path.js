function normalizePath(pathname = "/") {
  const value = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  return value.startsWith("/") ? value : `/${value}`;
}

export function deploymentBaseFromPath(pathname = "/") {
  const path = normalizePath(pathname);
  const gatewayMatch = path.match(/^\/(ipfs|ipns)\/([^/]+)(?:\/|$)/i);
  if (gatewayMatch) return `/${gatewayMatch[1].toLowerCase()}/${gatewayMatch[2]}/`;

  if (path === "/" || /^\/[^/]+$/.test(path) || /^\/404\.html$/i.test(path)) return "/";
  const directory = path.endsWith("/") ? path : path.slice(0, path.lastIndexOf("/") + 1);
  return directory || "/";
}

export function fallbackHashUrl(locationLike = globalThis.location) {
  const origin = String(locationLike?.origin || "").replace(/\/$/, "");
  return `${origin}${deploymentBaseFromPath(locationLike?.pathname || "/")}#/`;
}
