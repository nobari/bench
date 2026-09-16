"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Browsers that ask not to be tracked (Do Not Track or Global Privacy Control) are excluded. */
function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/**
 * Google Analytics 4. Loads only when NEXT_PUBLIC_GA_ID is set (production).
 *
 * Page views are sent by hand with the query string and hash stripped: tool
 * inputs live in the URL and must never reach Google. Automatic page views
 * are disabled (`send_page_view: false`) — also turn off "Page changes based
 * on browser history events" under Enhanced measurement in the GA4 property,
 * otherwise gtag.js would report the full URL on every nuqs URL update.
 * Google Signals and ad personalisation are off; ad consent is denied.
 */
export function GoogleAnalytics() {
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setAllowed(Boolean(GA_ID) && !optedOut());
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!allowed || !GA_ID) return;
    window.dataLayer = window.dataLayer ?? [];
    if (!window.gtag) {
      window.gtag = function () {
        // gtag.js expects the arguments object itself on the dataLayer, not an array.
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer?.push(arguments);
      };
    }
    if (!initialized.current) {
      initialized.current = true;
      window.gtag("consent", "default", {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "granted",
      });
      window.gtag("js", new Date());
      window.gtag("config", GA_ID, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });
    }
    window.gtag("event", "page_view", {
      page_location: `${window.location.origin}${pathname}`,
      page_path: pathname,
      page_title: document.title,
    });
  }, [allowed, pathname]);

  if (!allowed || !GA_ID) return null;
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />;
}
