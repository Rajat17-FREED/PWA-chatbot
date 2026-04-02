import type { InlineWidget } from '../../types';
import DRPSavingsWidget from './DRPSavingsWidget';
import DCPSavingsWidget from './DCPSavingsWidget';
import DEPSavingsWidget from './DEPSavingsWidget';
import GoalTrackerWidget from './GoalTrackerWidget';
import CarouselWidget from './CarouselWidget';
import YouTubeEmbedWidget from './YouTubeEmbedWidget';

interface Props {
  widget: InlineWidget;
}

export default function InlineWidgetRenderer({ widget }: Props) {
  switch (widget.type) {
    case 'drpSavings':
      return <DRPSavingsWidget totalDebt={widget.totalDebt} settlementAmount={widget.settlementAmount} savings={widget.savings} debtFreeMonths={widget.debtFreeMonths} />;
    case 'dcpSavings':
      return <DCPSavingsWidget currentTotalEMI={widget.currentTotalEMI} consolidatedEMI={widget.consolidatedEMI} emiSavings={widget.emiSavings} tenureMonths={widget.tenureMonths} />;
    case 'depSavings':
      return <DEPSavingsWidget interestWithout={widget.interestWithout} interestWith={widget.interestWith} interestSaved={widget.interestSaved} debtFreeMonths={widget.debtFreeMonths} />;
    case 'goalTracker':
      return <GoalTrackerWidget currentScore={widget.currentScore} targetScore={widget.targetScore} delta={widget.delta} />;
    case 'carousel':
      return <CarouselWidget items={widget.items} />;
    case 'youtubeEmbed':
      return <YouTubeEmbedWidget videoId={widget.videoId} title={widget.title} />;
    default:
      return null;
  }
}
