import {
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

type ConfigFieldProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
};

function withStoreConfigFieldClass(className?: string) {
  return ['store-config-field', className].filter(Boolean).join(' ');
}

export function ConfigField({ label, hint, htmlFor, children, className, ...props }: ConfigFieldProps) {
  const labelContent = htmlFor ? (
    <label className="store-config-field-label" htmlFor={htmlFor}>
      {label}
    </label>
  ) : (
    <span className="store-config-field-label">{label}</span>
  );

  return (
    <div className={withStoreConfigFieldClass(className)} {...props}>
      {labelContent}
      {hint ? <small className="store-config-field-hint">{hint}</small> : null}
      {children}
    </div>
  );
}

function withStoreConfigInputClass(className?: string) {
  return ['store-config-input', className].filter(Boolean).join(' ');
}

export function ConfigTextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={withStoreConfigInputClass(className)} {...props} />;
}

export function ConfigSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={withStoreConfigInputClass(className)} {...props} />;
}
