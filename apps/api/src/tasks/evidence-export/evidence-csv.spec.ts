import { toCsvField, toCsvRow } from './evidence-csv';

describe('toCsvField', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCsvField('a,b')).toBe('"a,b"');
    expect(toCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(toCsvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(toCsvField('-1')).toBe("'-1");
    expect(toCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('renders empty values as empty fields', () => {
    expect(toCsvField(null)).toBe('');
    expect(toCsvField(undefined)).toBe('');
  });
});

describe('toCsvRow', () => {
  it('joins escaped fields with commas', () => {
    expect(toCsvRow(['a', null, 'b,c'])).toBe('a,,"b,c"');
  });
});
