import { useState } from 'react';
import {
  Box,
  HardDrive,
  Cpu,
  Network,
  FileText,
  CircleCheck,
  Monitor,
  Play,
  Ellipsis,
  Radio,
  ChevronDown,
} from 'lucide-react';
import { ModelLogo } from '../../components/Brand';
import { Button } from '../../components/Button';
import type { DemoModel } from '../../mocks/modelLibrary';
import styles from './ModelCard.module.css';

interface ModelCardProps {
  model: DemoModel;
  active: boolean;
  grid: boolean;
  onStart: () => void;
  onStop: () => void;
  onRemove: () => void;
  onDetails: () => void;
  onCluster: () => void;
}

export function ModelCard({
  model,
  active,
  grid,
  onStart,
  onStop,
  onRemove,
  onDetails,
  onCluster,
}: ModelCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const metadata = [
    { label: 'Quantization', value: model.quantization, Icon: Box },
    { label: 'Size', value: model.size, Icon: HardDrive },
    { label: 'Architecture', value: model.architecture, Icon: Cpu },
    { label: 'Parameters', value: model.parameters, Icon: Network },
    { label: 'Context length', value: model.context, Icon: FileText },
    { label: 'Compatibility', value: 'Fully compatible', Icon: CircleCheck },
  ];
  const status = active ? 'Running' : model.ready ? 'Ready' : 'Stopped';
  return (
    <article
      aria-label={model.name}
      className={`${styles.card} ${active ? styles.active : ''} ${grid ? styles.gridCard : ''}`}
    >
      <div className={styles.identity}>
        <ModelLogo family={model.family} />
        <div className={styles.modelText}>
          <div className={styles.nameRow}>
            <h2>{model.name}</h2>
            <span className={`${styles.badge} ${status !== 'Stopped' ? styles.ready : ''}`}>
              <i />
              {status}
              {active && <ChevronDown size={12} />}
            </span>
          </div>
          <p>{model.description}</p>
        </div>
      </div>
      <div className={styles.metadata}>
        {metadata.map(({ label, value, Icon }) => (
          <div
            className={styles.tile}
            key={label}
            title={
              label === 'Compatibility'
                ? 'Sample compatibility only. No runtime has checked this model.'
                : undefined
            }
          >
            <Icon
              className={label === 'Compatibility' ? styles.compatibilityIcon : ''}
              size={active || grid ? 24 : 19}
              strokeWidth={1.7}
            />
            <div>
              <span>{label}</span>
              <strong className={label === 'Compatibility' ? styles.compatible : ''}>
                {value}
              </strong>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        {active ? (
          <Button variant="primary" onClick={onCluster}>
            <Monitor size={19} />
            Open in Cluster
          </Button>
        ) : (
          <Button variant="primary" onClick={onStart}>
            <Play size={15} />
            Start
          </Button>
        )}
        <div
          className={styles.menuAnchor}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenuOpen(false);
          }}
        >
          <button
            type="button"
            className={styles.menuButton}
            aria-label={`Actions for ${model.name}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Ellipsis size={20} />
          </button>
          {menuOpen && (
            <div className={styles.menu} aria-label={`Options for ${model.name}`}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDetails();
                }}
              >
                Model details
              </button>
              {active && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onStop();
                  }}
                >
                  Stop demo model
                </button>
              )}
              <button
                type="button"
                disabled={active}
                title={active ? 'Stop the demo model before removing this entry' : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
              >
                Remove demo entry
              </button>
            </div>
          )}
        </div>
      </div>
      {active && (
        <div className={styles.session}>
          <div className={styles.placement}>
            <Network size={29} />
            <div>
              <strong>Running on 4 machines · 4 GPUs</strong>
              <span>Automatic placement across cluster</span>
            </div>
          </div>
          <div className={styles.serving}>
            <Radio size={27} />
            <div>
              <strong>Currently serving requests</strong>
              <span>Started 2h 14m ago</span>
            </div>
          </div>
          <Button variant="icon" aria-label="View demo placement" onClick={onCluster}>
            <Ellipsis size={20} />
          </Button>
        </div>
      )}
    </article>
  );
}
