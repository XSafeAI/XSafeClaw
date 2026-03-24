import type { CSSProperties } from 'react';
import './IntroScreen.css';

type IntroScreenProps = {
  exiting?: boolean;
};

const introLayers = [
  {
    name: 'background',
    src: '/intro/Sunset/Background.png',
    style: {
      '--intro-x': '-1.4%',
      '--intro-y': '-2.4%',
      '--intro-scale': '1.1',
      '--intro-duration': '5.8s',
      '--intro-delay': '0.1s',
      '--intro-opacity': '0.95',
    },
  },
  {
    name: 'layer-1',
    src: '/intro/Sunset/1.png',
    style: {
      '--intro-x': '1.2%',
      '--intro-y': '-1.8%',
      '--intro-scale': '1.095',
      '--intro-duration': '5.4s',
      '--intro-delay': '0.34s',
      '--intro-opacity': '0.92',
    },
  },
  {
    name: 'layer-2',
    src: '/intro/Sunset/2.png',
    style: {
      '--intro-x': '-1%',
      '--intro-y': '-1.3%',
      '--intro-scale': '1.09',
      '--intro-duration': '5.1s',
      '--intro-delay': '0.58s',
      '--intro-opacity': '0.9',
    },
  },
  {
    name: 'layer-3',
    src: '/intro/Sunset/3.png',
    style: {
      '--intro-x': '1.1%',
      '--intro-y': '-0.8%',
      '--intro-scale': '1.085',
      '--intro-duration': '4.8s',
      '--intro-delay': '0.82s',
      '--intro-opacity': '0.92',
    },
  },
  {
    name: 'layer-4',
    src: '/intro/Sunset/4.png',
    style: {
      '--intro-x': '-1.4%',
      '--intro-y': '0.2%',
      '--intro-scale': '1.08',
      '--intro-duration': '4.6s',
      '--intro-delay': '1.08s',
      '--intro-opacity': '0.94',
    },
  },
  {
    name: 'layer-5',
    src: '/intro/Sunset/5.png',
    style: {
      '--intro-x': '1.6%',
      '--intro-y': '0.8%',
      '--intro-scale': '1.08',
      '--intro-duration': '4.3s',
      '--intro-delay': '1.34s',
      '--intro-opacity': '0.96',
    },
  },
  {
    name: 'layer-6',
    src: '/intro/Sunset/6.png',
    style: {
      '--intro-x': '-2%',
      '--intro-y': '1.4%',
      '--intro-scale': '1.09',
      '--intro-duration': '4.1s',
      '--intro-delay': '1.62s',
      '--intro-opacity': '0.97',
    },
  },
  {
    name: 'layer-7',
    src: '/intro/Sunset/7.png',
    style: {
      '--intro-x': '2.2%',
      '--intro-y': '2.8%',
      '--intro-scale': '1.095',
      '--intro-duration': '3.9s',
      '--intro-delay': '1.92s',
      '--intro-opacity': '0.98',
    },
  },
  {
    name: 'layer-8',
    src: '/intro/Sunset/8.png',
    style: {
      '--intro-x': '-2.6%',
      '--intro-y': '4.2%',
      '--intro-scale': '1.105',
      '--intro-duration': '3.7s',
      '--intro-delay': '2.24s',
      '--intro-opacity': '0.98',
    },
  },
  {
    name: 'foreground',
    src: '/intro/Sunset/Foreground.png',
    style: {
      '--intro-x': '0%',
      '--intro-y': '6.5%',
      '--intro-scale': '1.11',
      '--intro-duration': '3.4s',
      '--intro-delay': '2.58s',
      '--intro-opacity': '1',
    },
  },
] as const;

export default function IntroScreen({ exiting = false }: IntroScreenProps) {
  return (
    <div className={`intro-screen${exiting ? ' intro-screen--exit' : ''}`}>
      <div className="intro-screen__scene" aria-hidden="true">
        <div className="intro-screen__canvas">
          <img
            src="/intro/Sunset/expanded.png"
            alt=""
            className="intro-screen__backdrop"
          />

          {introLayers.map((layer) => (
            <div
              key={layer.name}
              className={`intro-screen__layer intro-screen__layer--${layer.name}`}
              style={layer.style as CSSProperties}
            >
              <img src={layer.src} alt="" />
            </div>
          ))}
        </div>

        <div className="intro-screen__sun-glow" />
        <div className="intro-screen__mist intro-screen__mist--top" />
        <div className="intro-screen__mist intro-screen__mist--bottom" />
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
