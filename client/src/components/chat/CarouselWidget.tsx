import { useRef, useState, useCallback, useEffect } from 'react';
import './CarouselWidget.css';

interface CarouselWidgetProps {
  items: Array<{ title: string; description: string }>;
}

export default function CarouselWidget({ items }: CarouselWidgetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.children.length === 0) return;
    const card = el.children[0] as HTMLElement;
    const cardWidth = card.offsetWidth + 10; // gap
    const idx = Math.round(el.scrollLeft / cardWidth);
    setActiveIndex(Math.min(idx, items.length - 1));
  }, [items.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const scrollTo = (idx: number) => {
    const el = scrollRef.current;
    if (!el || !el.children[idx]) return;
    (el.children[idx] as HTMLElement).scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  return (
    <div className="carousel-widget">
      <div className="carousel-widget__scroll" ref={scrollRef}>
        {items.map((item, i) => (
          <div key={i} className="carousel-widget__card">
            <div className="carousel-widget__card-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="carousel-widget__card-title">{item.title}</div>
            <p className="carousel-widget__card-desc">{item.description}</p>
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <div className="carousel-widget__dots">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`carousel-widget__dot ${i === activeIndex ? 'carousel-widget__dot--active' : ''}`}
              onClick={() => scrollTo(i)}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
