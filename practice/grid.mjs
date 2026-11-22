/** Mix the seed before Fisher–Yates so small seeds do not collapse the first swap. */
export function mixSeed(seed){
  let x=seed>>>0;
  x=Math.imul(x^(x>>>16),0x7feb352d);
  x=Math.imul(x^(x>>>15),0x846ca68b);
  return (x^(x>>>16))>>>0;
}

/** Return start slots for N cars. Solo (N=1) keeps seed%8. */
export function arenaGridSlots(seed,count){
  if(!Number.isInteger(count)||count<1)throw new RangeError('Invalid grid size');
  if(count===1)return [(seed>>>0)%8];
  const slots=Array.from({length:count},(_,i)=>i+1);
  let state=mixSeed(seed);
  for(let i=slots.length-1;i>0;i--){
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    const j=Math.floor(state/4294967296*(i+1));
    [slots[i],slots[j]]=[slots[j],slots[i]];
  }
  return slots;
}
