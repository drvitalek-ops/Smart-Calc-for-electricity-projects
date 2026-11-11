export type Point={x:number;y:number};
export type Box={x1:number;y1:number;x2:number;y2:number};
export function inside(point:Point,box:Box){return point.x>=box.x1&&point.x<=box.x2&&point.y>=box.y1&&point.y<=box.y2;}
export function segmentCrossesBox(a:Point,b:Point,box:Box){
  let low=0,high=1;const dx=b.x-a.x,dy=b.y-a.y;
  for(const [p,q] of [[-dx,a.x-box.x1],[dx,box.x2-a.x],[-dy,a.y-box.y1],[dy,box.y2-a.y]]){
    if(p===0){if(q<0)return false;continue;}
    const ratio=q/p;if(p<0)low=Math.max(low,ratio);else high=Math.min(high,ratio);if(low>high)return false;
  }
  return true;
}
export function selectionHits(points:Point[],box:Box,crossing:boolean){
  if(!points.length)return false;
  if(!crossing)return points.every(point=>inside(point,box));
  return points.some(point=>inside(point,box))||points.slice(1).some((point,index)=>segmentCrossesBox(points[index],point,box));
}
export function orthogonal(point:Point,anchor:Point|undefined,aspect:number):Point{
  if(!anchor)return point;
  return Math.abs(point.x-anchor.x)>=Math.abs(point.y-anchor.y)/aspect?{x:point.x,y:anchor.y}:{x:anchor.x,y:point.y};
}
export function measuredLength(points:Point[],page:{width:number;height:number;meters_per_point:number|null}){
  if(!page.meters_per_point)return null;
  return points.slice(1).reduce((sum,point,index)=>sum+Math.hypot((point.x-points[index].x)*page.width,(point.y-points[index].y)*page.height)*page.meters_per_point!,0);
}
/** Bucketed endpoint lookup keeps snapping independent of total plan size. */
export class VertexIndex{
  private cells=new Map<string,Point[]>();
  private bounds={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};
  constructor(points:Point[],private step=.025){if(!Number.isFinite(step)||step<=0)throw new RangeError('Invalid spatial index step');for(const point of points){if(!Number.isFinite(point.x)||!Number.isFinite(point.y))continue;const x=Math.floor(point.x/step),y=Math.floor(point.y/step);this.bounds.left=Math.min(this.bounds.left,x);this.bounds.right=Math.max(this.bounds.right,x);this.bounds.top=Math.min(this.bounds.top,y);this.bounds.bottom=Math.max(this.bounds.bottom,y);const key=this.key(point.x,point.y),bucket=this.cells.get(key)??[];bucket.push(point);this.cells.set(key,bucket);}}
  private key(x:number,y:number){return `${Math.floor(x/this.step)}:${Math.floor(y/this.step)}`;}
  nearest(point:Point,tx:number,ty:number,accept:(point:Point)=>boolean=()=>true):Point|null{
    if(![point.x,point.y,tx,ty].every(Number.isFinite)||tx<=0||ty<=0||!this.cells.size)return null;
    let distance=1,target:Point|null=null;
    for(let x=Math.max(this.bounds.left,Math.floor((point.x-tx)/this.step));x<=Math.min(this.bounds.right,Math.floor((point.x+tx)/this.step));x++)for(let y=Math.max(this.bounds.top,Math.floor((point.y-ty)/this.step));y<=Math.min(this.bounds.bottom,Math.floor((point.y+ty)/this.step));y++){
      for(const candidate of this.cells.get(`${x}:${y}`)??[]){if(!accept(candidate))continue;const value=((candidate.x-point.x)/tx)**2+((candidate.y-point.y)/ty)**2;if(value<=distance){distance=value;target=candidate;}}
    }
    return target;
  }
}
