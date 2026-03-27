import { useRef, useEffect, useState } from 'react';
import GameEngine from '../engine/GameEngine';
import { fetchData } from '../data/mockData';

/**
 * Self-contained PixiJS game canvas with internal loading management.
 * Uses a DOM ref to hide the loading screen directly (avoids React state batching issues).
 */
export default function GameCanvas({
  onNpcHover, onNpcLeave, onNpcClick, onPendingClick, onCursorStateChange, guardEnabled = false,
  onLayoutChange,
  onScreenTelemetryChange,
  mapConfig,
  refreshTrigger = 0,
}) {
  const containerRef  = useRef(null);
  const loadingRef    = useRef(null);
  const engineRef     = useRef(null);
  const refreshFnRef  = useRef(null);
  const [progress, setProgress]   = useState(0);
  const [loadText, setLoadText]   = useState('Loading assets...');

  // Keep callbacks in refs so the engine always has the latest copies
  const cbRef = useRef({
    onNpcHover, onNpcLeave, onNpcClick, onPendingClick, onCursorStateChange, onLayoutChange, onScreenTelemetryChange,
  });
  cbRef.current = {
    onNpcHover, onNpcLeave, onNpcClick, onPendingClick, onCursorStateChange, onLayoutChange, onScreenTelemetryChange,
  };

  useEffect(() => {
    if (!containerRef.current) return;
    let aborted = false;
    let refreshTimer = null;
    let hideLoadingTimer = null;
    let telemetryTimer = null;
    const engine = new GameEngine({ mapConfig });
    engineRef.current = engine;

    // Wire callbacks through ref
    engine.onNpcHover     = (...a) => cbRef.current.onNpcHover?.(...a);
    engine.onNpcLeave     = (...a) => cbRef.current.onNpcLeave?.(...a);
    engine.onNpcClick     = (...a) => cbRef.current.onNpcClick?.(...a);
    engine.onPendingClick = (...a) => cbRef.current.onPendingClick?.(...a);
    engine.onCursorStateChange = (...a) => cbRef.current.onCursorStateChange?.(...a);
    engine.onLayoutChange = (layout) => cbRef.current.onLayoutChange?.(layout);

    (async () => {
      try {
        engine.init(containerRef.current);

        await engine.loadAssets((p, label) => {
          if (aborted) return;
          setProgress(p);
          if (label) setLoadText(label);
        });
        if (aborted) return;

        const data = await fetchData();
        if (aborted) return;

        engine.populateNPCs(data.agents || [], data.events || []);

        const pushTelemetry = () => {
          if (aborted || !cbRef.current.onScreenTelemetryChange) return;
          cbRef.current.onScreenTelemetryChange(engine.getMapScreenTelemetry?.() || null);
        };
        if (cbRef.current.onScreenTelemetryChange) {
          pushTelemetry();
          telemetryTimer = setInterval(pushTelemetry, 180);
        }

        const doRefresh = async () => {
          try {
            const nextData = await fetchData();
            if (!aborted) {
              engine.updateData(nextData.agents || [], nextData.events || []);
              pushTelemetry();
            }
          } catch (_) {}
        };
        refreshFnRef.current = doRefresh;

        refreshTimer = setInterval(doRefresh, 15000);
      } catch (err) {
        console.error('[GameCanvas] init error:', err);
      }

      if (!aborted && loadingRef.current) {
        loadingRef.current.style.opacity = '0';
        loadingRef.current.style.pointerEvents = 'none';
        hideLoadingTimer = setTimeout(() => {
          if (loadingRef.current) loadingRef.current.style.display = 'none';
        }, 400);
      }
    })();

    return () => {
      aborted = true;
      refreshFnRef.current = null;
      if (refreshTimer) clearInterval(refreshTimer);
      if (telemetryTimer) clearInterval(telemetryTimer);
      if (hideLoadingTimer) clearTimeout(hideLoadingTimer);
      cbRef.current.onScreenTelemetryChange?.(null);
      engine.destroy();
      engineRef.current = null;
      cbRef.current.onCursorStateChange?.('normal');
    };
  }, [mapConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (refreshTrigger > 0) refreshFnRef.current?.();
  }, [refreshTrigger]);

  useEffect(() => {
    engineRef.current?.setGuardEnabled?.(guardEnabled);
  }, [guardEnabled]);

  return (
    <div className="townWrap visible">
      {/* Loading overlay — hidden via ref after engine ready */}
      <div ref={loadingRef} className="loading">
        <div className="loadingInner">
          <div className="loadingTitle">AGENT VALLEY</div>
          <div className="loadingBar">
            <div className="loadingFill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="loadingText">{loadText}</div>
        </div>
      </div>
      <div className="sceneContainer" ref={containerRef} />
    </div>
  );
}
