/**
 * @deprecated The 210px hero header is gone: the app bar (logo, section
 * links, data freshness) is now rendered once by <SiteNav> in
 * app/layout.tsx. This shim renders nothing so existing call sites
 * (PredictionsViewer, app/teams/page.tsx) drop the hero immediately; delete
 * those imports and then this file.
 */
export interface HeaderProps {
    lastRefresh?: string;
    compact?: boolean;
}

export default function Header(props: HeaderProps): null {
    void props;
    return null;
}
