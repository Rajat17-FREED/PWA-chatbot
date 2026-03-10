import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export default function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div className="pwa-page-header">
      <div className="pwa-page-header__inner">
        <h1 className="pwa-page-header__title">{title}</h1>
        {subtitle && <p className="pwa-page-header__subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}
