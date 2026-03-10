export default function LoadingScreen({ progress, text }) {
  return (
    <div className="loading">
      <div className="loadingInner">
        <div className="loadingTitle">AGENT TOWN</div>
        <div className="loadingBar">
          <div
            className="loadingFill"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="loadingText">{text}</div>
      </div>
    </div>
  );
}
