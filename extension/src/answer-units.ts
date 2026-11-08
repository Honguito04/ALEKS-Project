/** Unidades literales de un sufijo ya mostrado por el editor. No convierte magnitudes. */
const labels={
  h:['h','hr','hrs','hora','horas','hora(s)'],
  min:['min','minuto','minutos','minuto(s)'],
  s:['s','segundo','segundos','segundo(s)'],
  m:['m','metro','metros','metro(s)'],
  cm:['cm','centímetro','centímetros','centímetro(s)'],
  mm:['mm','milímetro','milímetros','milímetro(s)'],
  km:['km','kilómetro','kilómetros','kilómetro(s)'],
  g:['g','gramo','gramos','gramo(s)'],
  kg:['kg','kilogramo','kilogramos','kilogramo(s)'],
  L:['L','litro','litros','litro(s)'],
  mL:['mL','mililitro','mililitros','mililitro(s)'],
  'm^2':['m^2','m²'], 'cm^2':['cm^2','cm²'],
  'm^3':['m^3','m³'], 'cm^3':['cm^3','cm³'],
  '%':['%']
} as const;
export type FixedUnit=keyof typeof labels;
export const fixedUnits=Object.keys(labels) as [FixedUnit,...FixedUnit[]];
export function answerUnit(text:string):FixedUnit|undefined {
  const value=text.normalize('NFC').trim();
  return fixedUnits.find(unit=>(labels[unit] as readonly string[]).includes(value));
}
