export type SupportedAnswer={kind:'integer'|'decimal';value:string}|{kind:'fraction';value:string;numerator:string;denominator:string};

/** Closed grammar for editor actions; never interprets expressions or code. */
export function parseSupportedAnswer(value:string):SupportedAnswer|undefined {
  if(/^(0|[1-9]\d{0,11})$/u.test(value))return {kind:'integer',value};
  if(/^(0|[1-9]\d{0,11})[.,]\d{1,12}$/u.test(value))return {kind:'decimal',value};
  const match=/^(0|[1-9]\d{0,11})\/([1-9]\d{0,11})$/u.exec(value);
  if(!match)return;
  let a=BigInt(match[1]),b=BigInt(match[2]);
  while(b){const remainder=a%b;a=b;b=remainder;}
  if(a!==1n)return;
  return {kind:'fraction',value,numerator:match[1],denominator:match[2]};
}

export function sameAnswer(actual:string|undefined,expected:string|undefined) {
  return actual!==undefined && expected!==undefined && Boolean(parseSupportedAnswer(actual) && parseSupportedAnswer(expected)) && actual.replace(',', '.')===expected.replace(',', '.');
}
