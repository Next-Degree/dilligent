import { hipaaTrainingSections } from '@/lib/data/hipaa-training-content';

/** The HIPAA training text the member reads before acknowledging it. */
export function HipaaTrainingContent() {
  return (
    <div className="space-y-5">
      {hipaaTrainingSections.map((section) => (
        <div key={section.title} className="space-y-2">
          <h3 className="font-semibold text-sm">{section.title}</h3>
          <TrainingSectionContent content={section.content} />
        </div>
      ))}
    </div>
  );
}

function TrainingSectionContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (trimmed.replace(/[|\-\s]/g, '') === '') continue;
      inTable = true;
      const cells = trimmed
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    }

    if (inTable) {
      elements.push(<TrainingTable key={`table-${i}`} rows={tableRows} />);
      tableRows = [];
      inTable = false;
    }

    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      elements.push(
        <p key={i} className="font-medium text-sm mt-2">
          {trimmed.slice(2, -2)}
        </p>,
      );
    } else if (trimmed.startsWith('- ')) {
      elements.push(
        <li key={i} className="text-muted-foreground text-sm ml-4 list-disc">
          {trimmed.slice(2)}
        </li>,
      );
    } else if (trimmed) {
      elements.push(
        <p key={i} className="text-muted-foreground text-sm">
          {trimmed}
        </p>,
      );
    }
  }

  if (inTable && tableRows.length > 0) {
    elements.push(<TrainingTable key="table-end" rows={tableRows} />);
  }

  return <>{elements}</>;
}

function TrainingTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;
  const [header, ...body] = rows;

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {header.map((cell, i) => (
              <th key={i} className="px-3 py-2 text-left font-medium text-foreground">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="border-b last:border-0">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-muted-foreground">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
