const circle=(x,y,r)=>`M${x-r} ${y}a${r} ${r} 0 1 0 ${2*r} 0a${r} ${r} 0 1 0-${2*r} 0Z`;
export const trackpadV4 = [
 {id:'trackpad-contact-trails',paths:['M5 5h14q2 0 2 2v11q0 2-2 2H5q-2 0-2-2V7q0-2 2-2Z','M9 8v2M15 8v2',circle(9,13,1.2),circle(15,13,1.2)],reason:'Rounded wide pad with two circular contacts and short movement trails. Contact marks replace generic pause bars.'},
 {id:'trackpad-oblique-contacts',paths:['M3 9l15-4 3 12-15 4Z',circle(10,13,1.2),circle(15,12,1.2)],reason:'Flat oblique input surface and two finger contacts; distinguishes the pad from a window or upright machine frame.'},
 {id:'trackpad-two-fingers',paths:['M3 10h3M18 10h3v11H3V10','M7 13V5a2 2 0 0 1 4 0v6M11 11V4a2 2 0 0 1 4 0v9h3v4l-3 3H9l-4-5a1.5 1.5 0 0 1 2-2Z'],reason:'Two outlined fingers operating a lower pad field. This tests literal gesture recognition against the cleaner surface variants.'}
];
export default trackpadV4;
