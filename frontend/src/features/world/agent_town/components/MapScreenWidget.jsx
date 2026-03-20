import { useMemo } from 'react';
import './MapScreenWidget.css';

const MAX_VISIBLE_MARKERS = 40;

function getAlertTone(issueCount, guardCount) {
  if (issueCount > 0) return 'alert';
  if (guardCount > 0) return 'watch';
  return 'nominal';
}

function formatCount(value) {
  return String(value ?? 0).padStart(2, '0');
}

export default function MapScreenWidget({
  rect,
  sceneSize,
  displaySize,
  mapConfig,
  telemetry,
}) {
  const widgetStyle = useMemo(() => {
    if (!rect || !sceneSize?.w || !sceneSize?.h || !displaySize?.w || !displaySize?.h) {
      return null;
    }

    return {
      left: `${(rect.x / sceneSize.w) * displaySize.w}px`,
      top: `${(rect.y / sceneSize.h) * displaySize.h}px`,
      width: `${(rect.w / sceneSize.w) * displaySize.w}px`,
      height: `${(rect.h / sceneSize.h) * displaySize.h}px`,
    };
  }, [displaySize?.h, displaySize?.w, rect, sceneSize?.h, sceneSize?.w]);

  const markerData = useMemo(() => {
    const sceneW = telemetry?.sceneW || sceneSize?.w || 1;
    const sceneH = telemetry?.sceneH || sceneSize?.h || 1;
    const markers = Array.isArray(telemetry?.markers) ? telemetry.markers : [];

    const priority = { issue: 3, guard: 2, active: 1, idle: 0 };

    return markers
      .slice()
      .sort((a, b) => (priority[b.kind] || 0) - (priority[a.kind] || 0))
      .slice(0, MAX_VISIBLE_MARKERS)
      .map((marker) => ({
        ...marker,
        left: (marker.x / sceneW) * 100,
        top: (marker.y / sceneH) * 100,
      }));
  }, [sceneSize?.h, sceneSize?.w, telemetry]);

  if (!widgetStyle) return null;

  const agentCount = telemetry?.agentCount ?? 0;
  const issueCount = telemetry?.issueCount ?? 0;
  const guardCount = telemetry?.guardCount ?? 0;
  const alertTone = getAlertTone(issueCount, guardCount);
  const mapImage = mapConfig?.imageAsset || mapConfig?.previewImage || '';
  const activeCount = markerData.filter((marker) => marker.kind === 'active' || marker.kind === 'issue').length;

  return (
    <div
      className={`map-screen-widget is-${alertTone}`}
      style={widgetStyle}
      aria-hidden="true"
    >
      <div className="map-screen-widget__frame">
        <div className="map-screen-widget__glass">
          <div className="map-screen-widget__header">
            <div className="map-screen-widget__eyebrow">TACTICAL DISPLAY</div>
            <div className={`map-screen-widget__status is-${alertTone}`}>
              {alertTone === 'alert' ? 'ALERT' : alertTone === 'watch' ? 'WATCH' : 'NOMINAL'}
            </div>
          </div>

          <div className="map-screen-widget__body">
            <div className="map-screen-widget__map-shell">
              <div
                className="map-screen-widget__map-viewport"
                style={{ aspectRatio: `${sceneSize?.w || 1} / ${sceneSize?.h || 1}` }}
              >
                {mapImage ? (
                  <img
                    className="map-screen-widget__map-image"
                    src={mapImage}
                    alt=""
                    draggable={false}
                  />
                ) : null}
                <div className="map-screen-widget__map-frost" />
                <div className="map-screen-widget__map-grid" />
                <div className="map-screen-widget__map-sweep" />

                {markerData.map((marker) => (
                  <span
                    key={marker.id}
                    className={`map-screen-widget__marker is-${marker.kind}`}
                    style={{
                      left: `${marker.left}%`,
                      top: `${marker.top}%`,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="map-screen-widget__stats">
              <div className="map-screen-widget__title-block">
                <div className="map-screen-widget__title">{mapConfig?.label || 'Scene'}</div>
                <div className="map-screen-widget__subtitle">
                  {mapConfig?.visualLayer || 'Layer'} / live routing mirror
                </div>
              </div>

              <div className="map-screen-widget__metric-grid">
                <div className="map-screen-widget__metric">
                  <span>Agents</span>
                  <strong>{formatCount(agentCount)}</strong>
                </div>
                <div className="map-screen-widget__metric">
                  <span>Active</span>
                  <strong>{formatCount(activeCount)}</strong>
                </div>
                <div className="map-screen-widget__metric">
                  <span>Issues</span>
                  <strong>{formatCount(issueCount)}</strong>
                </div>
                <div className="map-screen-widget__metric">
                  <span>Guards</span>
                  <strong>{formatCount(guardCount)}</strong>
                </div>
              </div>

              <div className="map-screen-widget__meta">
                <div className="map-screen-widget__meta-row">
                  <span>Grid</span>
                  <strong>{sceneSize?.w || 0} x {sceneSize?.h || 0}</strong>
                </div>
                <div className="map-screen-widget__meta-row">
                  <span>Surface</span>
                  <strong>Glass screen / frosted relay</strong>
                </div>
                <div className="map-screen-widget__meta-row">
                  <span>Feed</span>
                  <strong>Routing + motion telemetry</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="map-screen-widget__footer">
            <span className="map-screen-widget__legend">
              <i className="is-active" />
              Agents
            </span>
            <span className="map-screen-widget__legend">
              <i className="is-guard" />
              Guard
            </span>
            <span className="map-screen-widget__legend">
              <i className="is-issue" />
              Issue
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
