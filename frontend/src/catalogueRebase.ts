/** Keep local edits while accepting unchanged fields from the shared card. */
export function rebaseCatalogue<T>(local:T,before:T,after:T):T{
  if(Object.is(local,before)||JSON.stringify(local)===JSON.stringify(before))return after;
  if(!local||!before||!after||typeof local!=='object'||typeof before!=='object'||typeof after!=='object'||Array.isArray(local)||Array.isArray(before)||Array.isArray(after))return local;
  const a=local as Record<string,unknown>,b=before as Record<string,unknown>,c=after as Record<string,unknown>,result={...a};let changed=false;
  for(const key of new Set([...Object.keys(b),...Object.keys(c)])){
    const next=rebaseCatalogue(a[key],b[key],c[key]);
    if(!Object.hasOwn(c,key)&&next===undefined){if(Object.hasOwn(result,key)){delete result[key];changed=true;}}
    else if(!Object.is(next,a[key])){result[key]=next;changed=true;}
  }
  return changed?result as T:local;
}
