import type { Editor } from '@tldraw/tldraw';
import { SearchBar } from './SearchBar';

interface TopBarProps {
  getEditor: () => Editor | null;
}

/**
 * TopBar — floats centered above the canvas.
 * Renders the SearchBar as the primary element.
 * The sidebar toggle sits as a ghost button on the left.
 */
export function TopBar({ getEditor }: TopBarProps) {
  return (
    <div style={styles.root}>
      <div style={styles.searchWrapper}>
        <SearchBar getEditor={getEditor} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    width: '100%',
  },
  searchWrapper: {
    flex: 1,
    minWidth: 0,
  },
};
