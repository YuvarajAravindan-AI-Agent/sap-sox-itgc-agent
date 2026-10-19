// The control library as data. Release 1: three controls; only the ones with `available: true` can be run.
module.exports = [
  { controlId: 'ITGC-AC-01', name: 'Segregation of duties (P2P and GL) and dormant privileged users', domain: 'ITGC access', frequency: 'quarterly', available: true, version: '1.0.0',
    passRule: 'No SoD conflict without a valid mitigating control, and no unlocked privileged dialog user without a login for 90 days.',
    population: 'Active (unlocked) dialog users with currently valid role assignments. Firefighter and service ids are out of scope.' },
  { controlId: 'FIN-JE-01', name: 'Manual journal entry review', domain: 'Financial close', frequency: 'quarterly', available: false, version: null,
    passRule: 'Every flagged manual journal has a documented independent review.',
    population: 'All manual postings in the period.' },
  { controlId: 'ITGC-CM-01', name: 'Change management to production', domain: 'ITGC change', frequency: 'quarterly', available: false, version: null,
    passRule: 'Every production transport has an approved ticket approved before release by someone other than the owner; emergency changes reviewed within 5 days.',
    population: 'All production transports released in the period.' }
]
