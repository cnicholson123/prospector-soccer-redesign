import { expect, it } from 'vitest';
import { availability } from '../../server/shop/availability.js';
import type { Product, Variant } from '../../server/shop/types.js';
const variant: Variant={_key:'00000001',label:'Youth M',group:'youth',active:true};
const product: Product={name:'Hoodie',slug:'hoodie',categoryId:'apparel',price:{amount:50},variants:[variant],salesMode:'preorder'};
const now=new Date('2026-11-09T20:00:00Z');
it.each([
 ['preorder',undefined,'preorder',10],['stock',undefined,'sold_out',0],['stock',{onHand:9,reserved:1,sold:2},'stock',6],['stock',{onHand:8,reserved:1,sold:2},'low',5],['stock',{onHand:3,reserved:1,sold:2},'sold_out',0],['waitlist',undefined,'waitlist',0],
] as const)('handles %s with %j', (salesMode,stock,state,cap)=>expect(availability({...product,salesMode},variant,stock,now)).toMatchObject({state,cap,available:cap>0}));
it.each(['preorder','stock','waitlist'] as const)('disables inactive variants in %s', salesMode=>expect(availability({...product,salesMode},{...variant,active:false},{onHand:100,reserved:0,sold:0},now)).toMatchObject({state:'inactive',available:false}));
it('uses an inclusive opening and exclusive closing, and handles blank bounds',()=>{
 for(const [opensAt,closesAt,state] of [['2026-11-09T20:00:01Z','','upcoming'],[now.toISOString(),'','preorder'],['',now.toISOString(),'closed'],['','2026-11-09T20:00:01Z','preorder']]) expect(availability({...product,preorder:{opensAt,closesAt}},variant,undefined,now).state).toBe(state);
});
it.each([0,1,4,10])('honors limited preorder cap %s minus sold/reserved', limit=>expect(availability(product,{...variant,limit},{onHand:0,reserved:1,sold:2},now).cap).toBe(Math.max(0,limit-3)));
it('labels sold-out waitlists and expected pickup without relying on color',()=>{
 expect(availability({...product,salesMode:'stock',allowWaitlist:true},variant,undefined,now).label).toBe('Sold out · join the waitlist');
 expect(availability({...product,preorder:{expectedDelivery:'mid-January'}},variant,undefined,now).label).toContain('pickup mid-January');
});
