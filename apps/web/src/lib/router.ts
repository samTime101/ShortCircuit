import { useEffect, useState } from "react";

export type Route = "studio" | "docs";

function readRoute(): Route {
  if (typeof window === "undefined") return "studio";
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith("/docs") || path.endsWith("/language")) return "docs";
  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (hash === "docs" || hash === "language") return "docs";
  return "studio";
}

/** Tiny hash-aware router: the studio lives at "/", the docs page at "/#/docs". */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);

  const navigate = (next: Route) => {
    if (next === "docs") {
      window.location.hash = "#/docs";
    } else {
      window.location.hash = "#/";
      if (window.location.pathname.toLowerCase().endsWith("/docs")) {
        window.history.pushState({}, "", "/");
      }
    }
    setRoute(next);
  };

  return [route, navigate];
}
