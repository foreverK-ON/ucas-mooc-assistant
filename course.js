// Loaded in the isolated course page and in the extension service worker.
const ucasCourse = (() => {
  const origin = new URL(chrome.runtime.getManifest().content_scripts[0].matches[0]).origin;

  function identifiers(url) {
    const ids = { courseid: null, clazzid: null };
    for (const [name, value] of url.searchParams) {
      const key = name.toLowerCase();
      if (!Object.hasOwn(ids, key)) continue;
      // An invalid or conflicting explicit value must not be treated as an omitted parameter.
      ids[key] = /^\d{1,24}$/.test(value) && (ids[key] === null || ids[key] === value) ? value : "";
    }
    return { courseId: ids.courseid, clazzid: ids.clazzid };
  }

  function read(address) {
    if (!address || !URL.canParse(address)) return null;
    const url = new URL(address);
    if (url.origin !== origin || !url.pathname.includes("/mycourse/") ||
        !(url.pathname.startsWith("/mooc2-ans/") || url.pathname.startsWith("/mooc-ans/mycourse/"))) return null;
    const { courseId, clazzid } = identifiers(url);
    return { courseId, clazzid, key: courseId && clazzid ? courseId + ":" + clazzid : "" };
  }

  function acceptsDestination(url, course) {
    if (!course?.key) return false;
    const { courseId, clazzid } = identifiers(url);
    return (courseId === null || courseId === course.courseId) && (clazzid === null || clazzid === course.clazzid);
  }

  return { read, acceptsDestination };
})();
