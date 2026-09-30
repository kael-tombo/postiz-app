'use client';

import { StarsAndForks } from '@gitroom/frontend/components/analytics/stars.and.forks';
import { FC, useCallback } from 'react';
import { StarsTableComponent } from '@gitroom/frontend/components/analytics/stars.table.component';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
export const AnalyticsComponent: FC = () => {
  const fetch = useFetch();
  const user = useUser();
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { isLoading: isLoadingAnalytics, data: analytics } = useSWR(
    '/analytics',
    load
  );
  const { isLoading: isLoadingTrending, data: trending } = useSWR(
    '/analytics/trending',
    load
  );
  const {
    data: integrations,
    isLoading: isLoadingIntegrations,
  } = useSWR('/integrations/list', load);
  if (isLoadingAnalytics || isLoadingTrending || isLoadingIntegrations) {
    return <LoadingComponent />;
  }
  const hasChannels = (integrations?.integrations || []).length > 0;
  return (
    <div className="flex flex-col gap-[24px] flex-1">
      {/* Honest framing (assessment N1/I2): this page reports repository
          analytics; per-post social performance lives on each post's
          statistics menu in the Calendar. */}
      <div className="bg-secondary border border-[var(--new-border)] rounded-[10px] p-[16px]">
        <div className="text-[18px] font-[600]">Repository analytics</div>
        <div className="text-[13px] text-textItemBlur mt-[4px]">
          Stars, forks and trending data for the repositories you track. For
          per-post social performance, open a post on the Calendar and choose
          &quot;Statistics&quot;.
        </div>
      </div>
      {!hasChannels && (
        <div className="bg-secondary border border-[var(--new-border)] rounded-[10px] p-[16px] text-[14px]">
          No channels connected yet — charts below show repository data only.
          Connect a channel from{' '}
          <a href="/launches" className="underline text-[var(--new-btn-primary)]">
            the Calendar
          </a>{' '}
          to start collecting social performance.
        </div>
      )}
      <div className="flex flex-col gap-[24px] flex-1">
        <StarsAndForks list={analytics} trending={trending} />
        <StarsTableComponent />
      </div>
    </div>
  );
};
