import { Component } from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from '../../../i18n';
import App from './App';
import './App.css';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#ff6b6b', background: '#1a1a2e', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>Runtime Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{String(this.state.error)}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#aaa', fontSize: 12, marginTop: 12 }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </I18nProvider>
);
