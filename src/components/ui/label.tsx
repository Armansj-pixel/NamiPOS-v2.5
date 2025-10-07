
import React from 'react';
export const Label: React.FC<React.LabelHTMLAttributes<HTMLLabelElement>> = ({children,...props}) => <label {...props} style={{fontSize:12, color:'#555'}}>{children}</label>;
