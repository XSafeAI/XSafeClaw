import './IntroScreen.css';

type IntroScreenProps = {
  exiting?: boolean;
};

export default function IntroScreen({ exiting = false }: IntroScreenProps) {
  return (
    <div className={`intro-screen${exiting ? ' intro-screen--exit' : ''}`}>
      <div className="intro-screen__scene" aria-hidden="true">
        <img
          src="/intro/background.png"
          alt=""
          className="intro-screen__backdrop"
        />
        <div className="intro-screen__sky-light" />
        <div className="intro-screen__light-rays" />
        <div className="intro-screen__lower-shade" />
        <img
          src="/intro/Cloud/Cloud2.png"
          alt=""
          className="intro-screen__cloud intro-screen__cloud--bottom-left-back"
        />
        <img
          src="/intro/Cloud/Cloud1_2.png"
          alt=""
          className="intro-screen__cloud intro-screen__cloud--bottom-left-soft"
        />
        <img
          src="/intro/Cloud/Cloud3.png"
          alt=""
          className="intro-screen__cloud intro-screen__cloud--bottom-left-front"
        />
        <img
          src="/intro/Cloud/Cloud2.png"
          alt=""
          className="intro-screen__cloud intro-screen__cloud--bottom-mid-back"
        />
        <img
          src="/intro/Cloud/Cloud3.png"
          alt=""
          className="intro-screen__cloud intro-screen__cloud--bottom-mid-front"
        />
        <img
          src="/intro/Cloud/Cloud1_2.png"
          alt=""
          className="intro-screen__cloud intro-screen__cloud--bottom-right-soft"
        />
        <img
          src="/intro/Cloud/Cloud3.png"
          alt=""
          className="intro-screen__cloud intro-screen__cloud--bottom-right-back"
        />
        <img
          src="/intro/Cloud/Cloud2.png"
          alt=""
          className="intro-screen__cloud intro-screen__cloud--bottom-right-under"
        />
        <div aria-hidden="true" className="intro-screen__depth-cloud intro-screen__depth-cloud--a" />
        <div aria-hidden="true" className="intro-screen__depth-cloud intro-screen__depth-cloud--b" />
        <div aria-hidden="true" className="intro-screen__depth-cloud intro-screen__depth-cloud--c" />
        <div aria-hidden="true" className="intro-screen__depth-cloud intro-screen__depth-cloud--d" />
        <div className="intro-screen__friends-shell">
          <div className="intro-screen__friends-glow" />
          <img
            src="/intro/friends-clean.png"
            alt=""
            className="intro-screen__friends intro-screen__friends--frame-a"
          />
          <img
            src="/intro/friends2-clean.png"
            alt=""
            className="intro-screen__friends intro-screen__friends--frame-b"
          />
        </div>
        <div className="intro-screen__vignette" />
      </div>

      <div className="intro-screen__content">
        <img
          src="/intro/logo_no-bg.png"
          alt="Safe Agent Valley"
          className="intro-screen__logo"
        />
      </div>
    </div>
  );
}
