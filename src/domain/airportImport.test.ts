import { describe, expect, it } from 'vitest';
import { AirportCsvError, parseOurAirports } from './airportImport';

const HEAD = '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code"';
const csv = (...rows: string[]) => [HEAD, ...rows].join('\n') + '\n';

describe('parseOurAirports', () => {
  it('imports an airport by its ICAO code', () => {
    const r = parseOurAirports(csv('2163,"EBOS","large_airport","Ostend-Bruges International Airport",51.1998,2.874673,13,"EU","BE","BE-VWV","Oostende","yes","EBOS","OST","EBOS",'));
    expect(r.airports).toEqual([{ icao: 'EBOS', name: 'Ostend-Bruges International Airport', lat: 51.1998, lon: 2.874673 }]);
    expect(r.summary).toMatchObject({ rows: 1, imported: 1 });
  });
  it('handles names with commas and quotes', () => {
    const r = parseOurAirports(csv('1,"EBAW","medium_airport","Antwerp, ""Deurne"" Airport",51.1894,4.46028,39,"EU","BE","BE-VAN","Antwerp","no","EBAW","ANR","EBAW",'));
    expect(r.airports[0]!.name).toBe('Antwerp, "Deurne" Airport');
  });
  it('falls back to gps_code, then ident, when there is no icao_code', () => {
    const r = parseOurAirports(csv(
      '1,"00A","heliport","Total RF Heliport",40.070985,-74.933689,11,"NA","US","US-PA","Bensalem","no",,,"K00A","00A"',
      '2,"00AA","small_airport","Aero B Ranch",38.704022,-101.473911,3435,"NA","US","US-KS","Leoti","no",,,"00AA","00AA"',
      '3,"EBZZ","small_airport","Ident only",50.1,4.1,1,"EU","BE","BE-X","X","no",,,,',
    ));
    expect(r.airports.map((a) => a.icao).sort()).toEqual(['00AA', 'EBZZ', 'K00A']);
  });
  it('skips closed airports, rows without a 4-character code and rows with bad coordinates, and counts them', () => {
    const r = parseOurAirports(csv(
      '1,"EBXX","closed","Gone",50,4,1,"EU","BE","BE-X","X","no","EBXX",,"EBXX",',
      '2,"BE-0012","small_airport","No code",50,4,1,"EU","BE","BE-X","X","no",,,,',
      '3,"EBYY","small_airport","Bad lat",95,4,1,"EU","BE","BE-X","X","no","EBYY",,"EBYY",',
      '4,"EBWW","small_airport","Empty lon",50,,1,"EU","BE","BE-X","X","no","EBWW",,"EBWW",',
      '5,"EBOK","small_airport","Fine",50.5,4.5,1,"EU","BE","BE-X","X","no","EBOK",,"EBOK",',
    ));
    expect(r.airports.map((a) => a.icao)).toEqual(['EBOK']);
    expect(r.summary).toEqual({ rows: 5, imported: 1, skippedClosed: 1, skippedNoCode: 1, skippedBadCoordinates: 2 });
  });
  it('keeps negative coordinates exactly (southern and western hemispheres)', () => {
    const r = parseOurAirports(csv('1,"SAWH","medium_airport","Ushuaia",-54.8433,-68.2958,102,"SA","AR","AR-V","Ushuaia","yes","SAWH","USH","SAWH",'));
    expect(r.airports[0]).toMatchObject({ lat: -54.8433, lon: -68.2958 });
  });
  it('prefers the row whose ident equals the code when two rows claim the same code', () => {
    const r = parseOurAirports(csv(
      '1,"XX-1","small_airport","Imposter",10,10,1,"EU","BE","BE-X","X","no","EBDU",,"EBDU",',
      '2,"EBDU","small_airport","Real",20,20,1,"EU","BE","BE-X","X","no","EBDU",,"EBDU",',
      '3,"XX-2","small_airport","Second imposter",30,30,1,"EU","BE","BE-X","X","no","EBDU",,"EBDU",',
    ));
    expect(r.airports).toHaveLength(1);
    expect(r.airports[0]!.name).toBe('Real');
  });
  it('finds columns by name, so reordered columns still work', () => {
    const r = parseOurAirports('name,longitude_deg,latitude_deg,ident,icao_code\n"Test Field",4.5,50.5,EBTT,EBTT\n');
    expect(r.airports).toEqual([{ icao: 'EBTT', name: 'Test Field', lat: 50.5, lon: 4.5 }]);
  });
  it('rejects a file that is not an OurAirports airports.csv, with a clear message and no partial result', () => {
    expect(() => parseOurAirports('a,b\n1,2\n')).toThrow(AirportCsvError);
    expect(() => parseOurAirports('a,b\n1,2\n')).toThrow(/missing column/);
    expect(() => parseOurAirports('')).toThrow(/empty/);
  });
  it('reports progress ending at 1', () => {
    const seen: number[] = [];
    const rows = Array.from({ length: 9000 }, (_, i) => `${i},"E${String(i % 10000).padStart(3, '0')}","small_airport","A${i}",50,4,1,"EU","BE","BE-X","X","no","E${String(i).padStart(3, '0')}",,"E${String(i).padStart(3, '0')}",`);
    parseOurAirports(csv(...rows), (f) => seen.push(f));
    expect(seen.at(-1)).toBe(1);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true);
  });
  it('parses a real OurAirports download when one is available', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    const path = process.env.AIRPORTS_CSV;
    if (!path || !existsSync(path)) return; // optional integration check, skipped by default
    const r = parseOurAirports(readFileSync(path, 'utf8'));
    const by = new Map(r.airports.map((a) => [a.icao, a]));
    expect(by.get('EBOS')!.lat).toBeCloseTo(51.1998, 3);
    expect(by.get('EBAW')!.name).toMatch(/Antwerp/);
    expect(by.get('SAWH')!.lat).toBeLessThan(-50);
    expect(r.airports.length).toBeGreaterThan(20000);
  });
});
