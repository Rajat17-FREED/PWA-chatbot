import './YouTubeEmbedWidget.css';

interface YouTubeEmbedWidgetProps {
  videoId: string;
  title?: string;
}

export default function YouTubeEmbedWidget({ videoId, title }: YouTubeEmbedWidgetProps) {
  return (
    <div className="yt-widget">
      <iframe
        className="yt-widget__frame"
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`}
        title={title || 'Video'}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
      {title && <div className="yt-widget__title">{title}</div>}
    </div>
  );
}
